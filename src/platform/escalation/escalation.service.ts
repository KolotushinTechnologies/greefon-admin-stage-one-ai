import { AccessDeniedError, ConflictError, NotFoundError } from "../shared/errors.js";
import { hasAtLeast, type StaffUser } from "../identity/types.js";
import type { StaffService } from "../identity/staff.service.js";
import type { TelegramMessenger } from "../../infrastructure/telegram/telegram.messenger.js";
import type { KnowledgeService } from "../knowledge/knowledge.service.js";
import type { UsageMeter } from "../analytics/usage.meter.js";
import type { EscalationRepository } from "./escalation.repository.js";
import type { Escalation } from "./types.js";
import { InlineKeyboard } from "grammy";

export class EscalationService {
  constructor(
    private readonly escalationDocs: EscalationRepository,
    private readonly staff: StaffService,
    private readonly messenger: TelegramMessenger,
    private readonly knowledge: KnowledgeService,
    private readonly usage: UsageMeter,
  ) {}

  async open(input: {
    parentTelegramId: string;
    parentChatId: string;
    parentMessageId?: number | null;
    parentUsername: string | null;
    parentDisplayName: string | null;
    question: string;
    reason: string;
  }): Promise<Escalation> {
    const doc = await this.escalationDocs.insert({
      status: "open",
      parentTelegramId: input.parentTelegramId,
      parentChatId: input.parentChatId,
      parentMessageId: input.parentMessageId ?? null,
      parentUsername: input.parentUsername,
      parentDisplayName: input.parentDisplayName,
      question: input.question,
      reason: input.reason,
      claimedByTelegramId: null,
      answer: null,
      notices: [],
    });
    await this.usage.bump("escalation");
    const desk = await this.staff.listDesk();
    const who = input.parentDisplayName ?? (input.parentUsername ? `@${input.parentUsername}` : "родитель");
    const text = [
      "**Родитель ждёт ответ**",
      who + (input.parentUsername ? ` (@${input.parentUsername})` : ""),
      "",
      `«${input.question}»`,
      "",
      input.reason,
    ].join("\n");
    const keyboard = new InlineKeyboard().text("Возьму", `e:c:${doc._id}`);
    const notices: Array<{ chatId: string; messageId: number }> = [];
    for (const person of desk) {
      const sent = await this.messenger.sendText(person.telegramUserId, text, keyboard);
      if (sent.ok && sent.telegramMessageId !== null) {
        notices.push({ chatId: person.telegramUserId, messageId: sent.telegramMessageId });
      }
    }
    const updated = await this.escalationDocs.update(doc._id, { notices });
    return updated ?? doc;
  }

  async claim(actor: StaffUser, id: string): Promise<string> {
    if (!actor.role || !hasAtLeast(actor.role, "admin")) {
      throw new AccessDeniedError("Заявки родителей берут админ и суперадмин.");
    }
    const doc = await this.escalationDocs.findById(id);
    if (!doc) {
      throw new NotFoundError("Заявку не нашёл.");
    }
    if (doc.status === "resolved") {
      return "Эту уже закрыли.";
    }
    if (doc.status === "claimed" && doc.claimedByTelegramId !== actor.telegramUserId) {
      throw new ConflictError("Уже взял кто-то другой.");
    }
    if (doc.status === "open") {
      await this.escalationDocs.update(id, {
        status: "claimed",
        claimedByTelegramId: actor.telegramUserId,
      });
      const taker = actor.displayName ?? actor.username ?? "коллега";
      for (const notice of doc.notices) {
        if (notice.chatId === actor.telegramUserId) {
          continue;
        }
        await this.messenger.editText(
          notice.chatId,
          notice.messageId,
          `Заявку взял **${taker}**.\n\n«${doc.question}»`,
        );
      }
    }
    return `Пиши ответ — уйдёт в чат, где спрашивали, reply на сообщение родителя.\n\nСпрашивали: «${doc.question}»`;
  }

  async resolve(actor: StaffUser, id: string, answer: string): Promise<string> {
    if (!actor.role || !hasAtLeast(actor.role, "admin")) {
      throw new AccessDeniedError();
    }
    const doc = await this.escalationDocs.findById(id);
    if (!doc) {
      throw new NotFoundError("Заявку не нашёл.");
    }
    if (doc.status === "resolved") {
      return "Эту уже закрыли.";
    }
    const text = answer.trim();
    if (text.length === 0) {
      return "Пустой ответ не отправлю.";
    }
    const tagged = tagParentInGroup(doc, text);
    const replyTo = doc.parentMessageId ?? undefined;
    await this.messenger.sendText(
      doc.parentChatId,
      tagged,
      undefined,
      replyTo !== undefined ? { replyToMessageId: replyTo } : undefined,
    );
    await this.escalationDocs.update(id, {
      status: "resolved",
      claimedByTelegramId: actor.telegramUserId,
      answer: text,
    });
    await this.knowledge.upsert({
      title: doc.question.slice(0, 80),
      body: `Вопрос: ${doc.question}\n\nОтвет: ${text}`,
      kind: "faq",
      namespace: "parents",
      actorTelegramId: actor.telegramUserId,
    });
    return "Ушло родителю (reply на его вопрос). Запомнила ответ — в следующий раз смогу сама.";
  }
}

/** В группе без reply хотя бы тегнем автора; с reply — тоже полезно в длинных чатах. */
function tagParentInGroup(doc: Escalation, answer: string): string {
  const isPrivate = doc.parentChatId === doc.parentTelegramId;
  if (isPrivate) {
    return answer;
  }
  const mention = doc.parentUsername
    ? `@${doc.parentUsername}`
    : `[${doc.parentDisplayName ?? "родитель"}](tg://user?id=${doc.parentTelegramId})`;
  if (answer.includes(mention) || (doc.parentUsername && answer.includes(`@${doc.parentUsername}`))) {
    return answer;
  }
  return `${mention}\n\n${answer}`;
}
