import { AccessDeniedError, ConflictError, NotFoundError } from "../shared/errors.js";
import { hasAtLeast, type StaffUser } from "../identity/types.js";
import type { StaffService } from "../identity/staff.service.js";
import type { TelegramMessenger } from "../../infrastructure/telegram/telegram.messenger.js";
import type { KnowledgeService } from "../knowledge/knowledge.service.js";
import type { UsageMeter } from "../analytics/usage.meter.js";
import type { CopilotService } from "../copilot/copilot.service.js";
import type { AiActionLogRepository } from "../copilot/ai-action-log.repository.js";
import type { ContextHintsService } from "../copilot/context-hints.service.js";
import type { LeadRepository } from "../copilot/lead.repository.js";
import type { CrmLinkService } from "../copilot/crm-link.service.js";
import type { CopilotBrief } from "../copilot/types.js";
import type { EscalationRepository } from "./escalation.repository.js";
import {
  FOLLOW_UP_LABELS,
  followUpKindSchema,
  type Escalation,
  type FollowUpKind,
} from "./types.js";
import { InlineKeyboard } from "grammy";

export class EscalationService {
  constructor(
    private readonly escalationDocs: EscalationRepository,
    private readonly staff: StaffService,
    private readonly messenger: TelegramMessenger,
    private readonly knowledge: KnowledgeService,
    private readonly usage: UsageMeter,
    private readonly copilot: CopilotService,
    private readonly aiActions: AiActionLogRepository,
    private readonly contextHints: ContextHintsService,
    private readonly leads: LeadRepository,
    private readonly crmLinks: CrmLinkService,
  ) {}

  async open(input: {
    parentTelegramId: string;
    parentChatId: string;
    parentMessageId?: number | null;
    parentUsername: string | null;
    parentDisplayName: string | null;
    question: string;
    reason: string;
    /** Уже разобранный brief — чтобы не звать LLM дважды. */
    brief?: CopilotBrief;
  }): Promise<Escalation> {
    const brief =
      input.brief ??
      (await this.copilot.analyzeInbound({
        question: input.question,
        reason: input.reason,
        parentDisplayName: input.parentDisplayName,
      }));

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
      draftReply: brief.draftReply,
      intent: brief.intent,
      heat: brief.heat,
      followUpNote: brief.adminHints[0] ?? brief.stageLabel,
      followUpKind: "none",
      botAlreadyReplied: input.reason.startsWith("auto_desk:"),
      notices: [],
    });
    await this.usage.bump("escalation");
    await this.aiActions.record({
      kind: "inbound_analyzed",
      escalationId: doc._id,
      parentTelegramId: input.parentTelegramId,
      payload: {
        intent: brief.intent,
        heat: brief.heat,
        stageLabel: brief.stageLabel,
        nextSalesStep: brief.nextSalesStep,
        draftLen: brief.draftReply.length,
        botAlreadyReplied: doc.botAlreadyReplied,
      },
    });

    const desk = await this.staff.listDesk();
    const who = input.parentDisplayName ?? (input.parentUsername ? `@${input.parentUsername}` : "родитель");
    const whoLine = who + (input.parentUsername ? ` (@${input.parentUsername})` : "");
    const link = await this.crmLinks.get(input.parentTelegramId);
    const linkLine = this.crmLinks.formatShort(link);
    const autoNote = doc.botAlreadyReplied
      ? "⚠️ Бот уже ответил родителю. Лучше **дожать** вручную, а не слать тот же черновик.\n\n"
      : "";
    const text =
      autoNote +
      this.copilot.formatAdminCard({
        who: whoLine,
        question: input.question,
        brief,
      }) +
      (linkLine ? `\n\n${linkLine}` : "");
    const hintBlock = this.contextHints.formatBlock(await this.contextHints.forEscalation(doc));
    const keyboard = deskCaseKeyboard(doc);
    const notices: Array<{ chatId: string; messageId: number }> = [];
    for (const person of desk) {
      const sent = await this.messenger.sendText(person.telegramUserId, `${text}${hintBlock}`, keyboard);
      if (sent.ok && sent.telegramMessageId !== null) {
        notices.push({ chatId: person.telegramUserId, messageId: sent.telegramMessageId });
      }
    }
    const updated = await this.escalationDocs.update(doc._id, { notices });
    await this.leads.upsertFromEscalation({
      parentTelegramId: input.parentTelegramId,
      parentUsername: input.parentUsername,
      parentDisplayName: input.parentDisplayName,
      escalationId: doc._id,
      intent: brief.intent,
      heat: brief.heat,
      heatWhy: brief.heatWhy,
      stageLabel: brief.stageLabel,
      nextSalesStep: brief.nextSalesStep,
      lead: brief.lead,
      question: input.question,
    });
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
    if (doc.status === "resolved" || doc.status === "cancelled") {
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
    await this.aiActions.record({
      kind: "escalation_claimed",
      actor: "staff",
      actorTelegramId: actor.telegramUserId,
      escalationId: id,
      parentTelegramId: doc.parentTelegramId,
    });
    const draftHint = doc.draftReply
      ? `\n\nЧерновик AI (можно править):\n${doc.draftReply}`
      : "";
    const hints = this.contextHints.formatBlock(await this.contextHints.forEscalation(doc));
    return `Пиши ответ — уйдёт в чат, где спрашивали, reply на сообщение родителя.\n\nСпрашивали: «${doc.question}»${draftHint}${hints}`;
  }

  /** Отправить черновик AI без ручного набора — человек подтвердил кнопкой. */
  async sendDraft(actor: StaffUser, id: string): Promise<string> {
    if (!actor.role || !hasAtLeast(actor.role, "admin")) {
      throw new AccessDeniedError();
    }
    const doc = await this.escalationDocs.findById(id);
    if (!doc) {
      throw new NotFoundError("Заявку не нашёл.");
    }
    const draft = (doc.draftReply ?? "").trim();
    if (draft.length === 0) {
      return "Черновика нет — жми «Изменить» и напиши ответ сам.";
    }
    await this.aiActions.record({
      kind: "draft_send_confirmed",
      actor: "staff",
      actorTelegramId: actor.telegramUserId,
      escalationId: id,
      parentTelegramId: doc.parentTelegramId,
      payload: { draftLen: draft.length },
    });
    return this.resolve(actor, id, draft);
  }

  async callHint(actor: StaffUser, id: string): Promise<string> {
    if (!actor.role || !hasAtLeast(actor.role, "admin")) {
      throw new AccessDeniedError();
    }
    const doc = await this.escalationDocs.findById(id);
    if (!doc) {
      throw new NotFoundError("Заявку не нашёл.");
    }
    const who = doc.parentDisplayName ?? (doc.parentUsername ? `@${doc.parentUsername}` : "родитель");
    const nick = doc.parentUsername ? `@${doc.parentUsername}` : "username нет";
    const link = await this.crmLinks.get(doc.parentTelegramId);
    await this.aiActions.record({
      kind: "call_hint_opened",
      actor: "staff",
      actorTelegramId: actor.telegramUserId,
      escalationId: id,
      parentTelegramId: doc.parentTelegramId,
    });
    return [
      `Позвонить: **${who}**`,
      `Telegram: ${nick}`,
      `id: \`${doc.parentTelegramId}\``,
      link?.phone ? `Тел (CRM): ${link.phone}` : "Телефона в связке нет — жми «CRM» и привяжи номер.",
      this.crmLinks.formatShort(link),
      "",
      `Спрашивали: «${doc.question}»`,
    ]
      .filter((x): x is string => Boolean(x))
      .join("\n");
  }

  /** Карточка дела из утреннего дайджеста. */
  async openCard(actor: StaffUser, id: string): Promise<{ text: string; inline: InlineKeyboard }> {
    if (!actor.role || !hasAtLeast(actor.role, "admin")) {
      throw new AccessDeniedError();
    }
    const doc = await this.escalationDocs.findById(id);
    if (!doc) {
      throw new NotFoundError("Заявку не нашёл.");
    }
    if (doc.status === "resolved" || doc.status === "cancelled") {
      return {
        text: `Уже закрыто (${doc.status}).\n\n«${doc.question}»`,
        inline: new InlineKeyboard(),
      };
    }
    const who = doc.parentDisplayName ?? (doc.parentUsername ? `@${doc.parentUsername}` : "родитель");
    const idleH = Math.max(0, Math.round((Date.now() - new Date(doc.updatedAt).getTime()) / 3_600_000));
    const hints = this.contextHints.formatBlock(await this.contextHints.forEscalation(doc));
    const lead = await this.leads.findByParent(doc.parentTelegramId);
    const link = await this.crmLinks.get(doc.parentTelegramId);
    const kind = (doc.followUpKind ?? "none") as FollowUpKind;
    const text = [
      `**Дело** · ${doc.status === "claimed" ? "в работе" : "открыто"}`,
      who + (doc.parentUsername ? ` (@${doc.parentUsername})` : ""),
      `Намерение: ${doc.intent ?? "—"} · температура: ${doc.heat ?? "—"}`,
      `Follow-up: ${FOLLOW_UP_LABELS[kind]}`,
      doc.followUpNote ? `Заметка: ${doc.followUpNote}` : null,
      lead?.stageLabel ? `Стадия лида: ${lead.stageLabel}` : null,
      lead?.nextSalesStep ? `💰 След. шаг: ${lead.nextSalesStep}` : null,
      this.crmLinks.formatShort(link),
      doc.botAlreadyReplied ? "⚠️ Бот уже ответил родителю" : null,
      `Без движения: ~${idleH} ч`,
      "",
      `«${doc.question}»`,
      "",
      doc.draftReply ? `Черновик:\n${doc.draftReply}` : "Черновика нет — жми «Дожать» / «Изменить».",
      hints,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
    await this.aiActions.record({
      kind: "case_opened",
      actor: "staff",
      actorTelegramId: actor.telegramUserId,
      escalationId: id,
      parentTelegramId: doc.parentTelegramId,
    });
    return { text, inline: deskCaseKeyboard(doc, true) };
  }

  async setFollowUp(actor: StaffUser, id: string, kindRaw: string): Promise<string> {
    if (!actor.role || !hasAtLeast(actor.role, "admin")) {
      throw new AccessDeniedError();
    }
    const parsed = followUpKindSchema.safeParse(kindRaw);
    if (!parsed.success) {
      return "Неизвестная метка follow-up.";
    }
    const kind = parsed.data;
    const doc = await this.escalationDocs.findById(id);
    if (!doc) {
      throw new NotFoundError("Заявку не нашёл.");
    }
    const patch: Partial<Escalation> = {
      followUpKind: kind,
      followUpNote: FOLLOW_UP_LABELS[kind],
    };
    if (kind === "won" || kind === "lost") {
      patch.status = "cancelled";
      patch.claimedByTelegramId = actor.telegramUserId;
    }
    await this.escalationDocs.update(id, patch);
    await this.aiActions.record({
      kind: "follow_up_set",
      actor: "staff",
      actorTelegramId: actor.telegramUserId,
      escalationId: id,
      parentTelegramId: doc.parentTelegramId,
      payload: { followUpKind: kind },
    });
    if (kind === "won" || kind === "lost") {
      return `Пометил как «${FOLLOW_UP_LABELS[kind]}» и снял с открытых дел.`;
    }
    return `Follow-up: **${FOLLOW_UP_LABELS[kind]}**. Утром попадёт в нужный блок «дел».`;
  }

  /** Обновить/показать черновик и перевести в режим правки. */
  async suggestReply(actor: StaffUser, id: string): Promise<string> {
    if (!actor.role || !hasAtLeast(actor.role, "admin")) {
      throw new AccessDeniedError();
    }
    const doc = await this.escalationDocs.findById(id);
    if (!doc) {
      throw new NotFoundError("Заявку не нашёл.");
    }
    if (doc.status === "resolved" || doc.status === "cancelled") {
      return "Это дело уже закрыто.";
    }
    let draft = (doc.draftReply ?? "").trim();
    if (draft.length === 0) {
      const brief = await this.copilot.analyzeInbound({
        question: doc.question,
        reason: doc.reason,
        parentDisplayName: doc.parentDisplayName,
      });
      draft = brief.draftReply;
      await this.escalationDocs.update(id, {
        draftReply: draft,
        intent: brief.intent,
        heat: brief.heat,
        followUpNote: brief.adminHints[0] ?? brief.stageLabel,
      });
    }
    await this.aiActions.record({
      kind: "draft_suggested",
      actor: "staff",
      actorTelegramId: actor.telegramUserId,
      escalationId: id,
      parentTelegramId: doc.parentTelegramId,
    });
    const claimPrompt = await this.claim(actor, id);
    return `${claimPrompt}\n\nМожно сразу отправить черновик кнопкой «Отправить» в карточке, или пришли свой текст.`;
  }

  /** Закрыть без ответа родителю (сняли с контроля). */
  async closeQuietly(actor: StaffUser, id: string): Promise<string> {
    if (!actor.role || !hasAtLeast(actor.role, "admin")) {
      throw new AccessDeniedError();
    }
    const doc = await this.escalationDocs.findById(id);
    if (!doc) {
      throw new NotFoundError("Заявку не нашёл.");
    }
    if (doc.status === "resolved" || doc.status === "cancelled") {
      return "Уже закрыто.";
    }
    await this.escalationDocs.update(id, {
      status: "cancelled",
      claimedByTelegramId: actor.telegramUserId,
    });
    await this.aiActions.record({
      kind: "case_closed_quietly",
      actor: "staff",
      actorTelegramId: actor.telegramUserId,
      escalationId: id,
      parentTelegramId: doc.parentTelegramId,
    });
    for (const notice of doc.notices) {
      await this.messenger
        .editText(
          notice.chatId,
          notice.messageId,
          `Снято с контроля **${actor.displayName ?? actor.username ?? "админ"}**.\n\n«${doc.question}»`,
        )
        .catch(() => undefined);
    }
    return "Закрыл без ответа родителю. Из «дел на сегодня» пропадёт.";
  }

  async resolve(actor: StaffUser, id: string, answer: string): Promise<string> {
    if (!actor.role || !hasAtLeast(actor.role, "admin")) {
      throw new AccessDeniedError();
    }
    const doc = await this.escalationDocs.findById(id);
    if (!doc) {
      throw new NotFoundError("Заявку не нашёл.");
    }
    if (doc.status === "resolved" || doc.status === "cancelled") {
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
    await this.aiActions.record({
      kind: "escalation_resolved",
      actor: "staff",
      actorTelegramId: actor.telegramUserId,
      escalationId: id,
      parentTelegramId: doc.parentTelegramId,
      payload: { answerLen: text.length },
    });
    for (const notice of doc.notices) {
      await this.messenger.editText(
        notice.chatId,
        notice.messageId,
        `Закрыто **${actor.displayName ?? actor.username ?? "админ"}**.\n\n«${doc.question}»\n\nОтвет ушёл родителю.`,
      ).catch(() => undefined);
    }
    return "Ушло родителю (reply на его вопрос). Запомнила ответ — в следующий раз смогу сама.";
  }
}

function deskCaseKeyboard(doc: Escalation, withClose = false): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (doc.botAlreadyReplied) {
    kb.text("Дожать", `e:c:${doc._id}`).text("Всё же отправить", `e:s:${doc._id}`);
  } else {
    kb.text("Отправить", `e:s:${doc._id}`).text("Изменить", `e:c:${doc._id}`);
  }
  kb.row().text("Позвонить", `e:p:${doc._id}`).text("CRM", `e:crm:${doc._id}`);
  kb.row()
    .text("→ Придёт", `e:f:promised_visit:${doc._id}`)
    .text("→ Оплата", `e:f:await_payment:${doc._id}`);
  kb.row()
    .text("→ После пробного", `e:f:after_trial:${doc._id}`)
    .text("→ Прогрев", `e:f:nurture:${doc._id}`);
  kb.row().text("Купили", `e:f:won:${doc._id}`).text("Потеряны", `e:f:lost:${doc._id}`);
  if (withClose) {
    kb.row().text("Закрыть", `e:x:${doc._id}`);
  }
  return kb;
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
