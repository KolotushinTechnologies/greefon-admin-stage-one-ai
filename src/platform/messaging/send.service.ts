import { randomUUID } from "node:crypto";
import type { JobQueues } from "../../infrastructure/bullmq/queues.js";
import type { RabbitEventBus } from "../../infrastructure/rabbitmq/event-bus.js";
import type { ConversationStore } from "../conversation/conversation.store.js";
import type { OutboundMedia } from "../conversation/types.js";
import { ConfirmationRequiredError, NotFoundError } from "../shared/errors.js";
import type { ChatRecord } from "../org/types.js";
import type { OutboundMessage, OutboundRepository } from "./outbound.repository.js";

export type RecentBroadcastItem = {
  index: number;
  id: string;
  preview: string;
  mediaCount: number;
  mediaSummary: string;
  destinations: string[];
  createdAt: string;
};

export class SendService {
  constructor(
    private readonly outbound: OutboundRepository,
    private readonly queues: JobQueues,
    private readonly conversations: ConversationStore,
    private readonly events: RabbitEventBus,
  ) {}

  async requestOrSend(input: {
    actorTelegramId: string;
    text: string;
    chats: ChatRecord[];
    summary: string;
    media?: OutboundMedia[];
  }): Promise<{
    outboundId: string;
    queued: number;
    confirmationAsked: boolean;
    message: string;
    mediaCount: number;
    mediaSummary: string;
  }> {
    if (input.chats.length === 0) {
      throw new NotFoundError("Некуда отправлять.");
    }
    const media = input.media ?? [];
    if (input.chats.length > 1) {
      const confirmationId = randomUUID();
      await this.conversations.setPendingSend(input.actorTelegramId, {
        kind: "send_message",
        confirmationId,
        text: input.text,
        chatIds: input.chats.map((chat) => chat.telegramChatId),
        labels: input.chats.map((chat) => chat.title),
        media,
        createdAt: new Date().toISOString(),
      });
      const list = input.chats
        .slice(0, 12)
        .map((chat, index) => `${index + 1}. ${chat.title}`)
        .join("\n");
      const mediaNote = media.length > 0 ? `\nВложений: ${media.length}` : "\nВложений нет — уйдёт только текст.";
      throw new ConfirmationRequiredError(
        `Я собрал ${input.chats.length} чатов (${input.summary}).${mediaNote}\n${list}${input.chats.length > 12 ? "\n…" : ""}\n\nОтправить во все?`,
        confirmationId,
      );
    }
    return this.enqueue(input.actorTelegramId, input.text, input.chats, media);
  }

  async confirmPending(actorTelegramId: string, accepted: boolean, confirmationId?: string): Promise<string> {
    const pending = accepted
      ? await this.conversations.takePendingSend(actorTelegramId, confirmationId)
      : await this.conversations.takePendingSend(actorTelegramId);
    if (!pending) {
      return "Сейчас нет рассылки, которую нужно подтверждать.";
    }
    if (!accepted) {
      return "Ок, не отправляю.";
    }
    const chats = pending.chatIds.map((chatId, index) => ({
      telegramChatId: chatId,
      title: pending.labels[index] ?? chatId,
    }));
    const result = await this.enqueue(actorTelegramId, pending.text, chats, pending.media ?? []);
    return result.message;
  }

  /** Отправка из кнопочного выбора: без второго «точно?» — выбор уже сделан. */
  async sendToChatsNow(input: {
    actorTelegramId: string;
    text: string;
    chats: ChatRecord[];
    media?: OutboundMedia[];
  }): Promise<string> {
    if (input.chats.length === 0) {
      throw new NotFoundError("Некуда отправлять.");
    }
    const result = await this.enqueue(
      input.actorTelegramId,
      input.text,
      input.chats.map((chat) => ({ telegramChatId: chat.telegramChatId, title: chat.title })),
      input.media ?? [],
    );
    return result.message;
  }

  async listRecent(actorTelegramId: string, limit = 8): Promise<RecentBroadcastItem[]> {
    const docs = await this.outbound.listRecentByActor(actorTelegramId, limit);
    return docs.map((doc, index) => summarizeBroadcast(doc, index + 1));
  }

  async resend(input: {
    actorTelegramId: string;
    outboundId?: string;
    index?: number;
    chats: ChatRecord[];
    summary: string;
  }): Promise<{
    outboundId: string;
    queued: number;
    confirmationAsked: boolean;
    message: string;
    mediaCount: number;
    mediaSummary: string;
    sourceId: string;
  }> {
    const source = await this.resolveSource(input.actorTelegramId, input.outboundId, input.index);
    const result = await this.requestOrSend({
      actorTelegramId: input.actorTelegramId,
      text: source.text,
      chats: input.chats,
      summary: input.summary,
      media: source.media,
    });
    return { ...result, sourceId: source._id };
  }

  private async resolveSource(
    actorTelegramId: string,
    outboundId: string | undefined,
    index: number | undefined,
  ): Promise<OutboundMessage> {
    if (outboundId) {
      const doc = await this.outbound.findById(outboundId);
      if (!doc || doc.actorTelegramId !== actorTelegramId) {
        throw new NotFoundError("Такую рассылку не нашёл.");
      }
      return doc;
    }
    if (index !== undefined && Number.isFinite(index) && index >= 1) {
      const recent = await this.outbound.listRecentByActor(actorTelegramId, Math.max(index, 8));
      const doc = recent[index - 1];
      if (!doc) {
        throw new NotFoundError(`Рассылки №${index} нет. Сначала list_recent_broadcasts.`);
      }
      return doc;
    }
    throw new NotFoundError("Нужен id рассылки или номер из списка (1, 2, …).");
  }

  private async enqueue(
    actorTelegramId: string,
    text: string,
    chats: Array<{ telegramChatId: string; title: string }>,
    media: OutboundMedia[],
  ): Promise<{
    outboundId: string;
    queued: number;
    confirmationAsked: boolean;
    message: string;
    mediaCount: number;
    mediaSummary: string;
  }> {
    const outbound = await this.outbound.create(
      actorTelegramId,
      text,
      chats.map((chat) => ({
        chatId: chat.telegramChatId,
        title: chat.title,
        status: "queued",
        error: null,
        telegramMessageId: null,
      })),
      media,
    );
    await this.queues.broadcast.add(
      "broadcast",
      { outboundId: outbound._id },
      { jobId: `broadcast-${outbound._id}` },
    );
    const mediaSummary = describeMediaPackage(media, text);
    const mediaNote = media.length > 0 ? ` (${mediaSummary})` : " (только текст)";
    return {
      outboundId: outbound._id,
      queued: chats.length,
      confirmationAsked: false,
      mediaCount: media.length,
      mediaSummary,
      message: `Ставлю в очередь отправку${mediaNote} в ${chats.length} чат(ов). Напишу, как дойдёт.`,
    };
  }

  async report(outboundId: string): Promise<string> {
    const doc = await this.outbound.findById(outboundId);
    if (!doc) {
      return "Отчёт по отправке не нашёл.";
    }
    const sent = doc.deliveries.filter((item) => item.status === "sent");
    const failed = doc.deliveries.filter((item) => item.status === "failed");
    const queued = doc.deliveries.filter((item) => item.status === "queued");
    const mediaSummary = describeMediaPackage(doc.media ?? [], doc.text);
    await this.events.publish("message.sent", {
      outboundId,
      sent: sent.length,
      failed: failed.length,
    });
    if (queued.length > 0) {
      return `Ещё уходит: ${queued.length}. Ушло ${sent.length} из ${doc.deliveries.length}${failed.length > 0 ? `, не дошло: ${failed.map((item) => item.title).join(", ")}` : ""}. Пакет: ${mediaSummary}.`;
    }
    const lines = sent.map((item) => `• ${shortTitle(item.title)} — ${mediaSummary}`);
    if (failed.length === 0) {
      return `Готово. Сообщение ушло в ${sent.length} из ${doc.deliveries.length} чатов.\n${lines.join("\n")}`;
    }
    return `Сообщение ушло в ${sent.length} из ${doc.deliveries.length}. Пакет: ${mediaSummary}.\nНе дошло: ${failed.map((item) => item.title).join(", ")}.`;
  }
}

function summarizeBroadcast(doc: OutboundMessage, index: number): RecentBroadcastItem {
  const destinations = [...new Set(doc.deliveries.map((item) => shortTitle(item.title)))];
  return {
    index,
    id: doc._id,
    preview: previewText(doc.text),
    mediaCount: doc.media?.length ?? 0,
    mediaSummary: describeMediaPackage(doc.media ?? [], doc.text),
    destinations,
    createdAt: doc.createdAt.toISOString(),
  };
}

export function describeMediaPackage(media: OutboundMedia[], text: string): string {
  const hasText = text.trim().length > 0;
  if (media.length === 0) {
    return hasText ? "только текст" : "пусто";
  }
  const photos = media.filter((item) => item.kind === "photo").length;
  const videos = media.filter((item) => item.kind === "video").length;
  const docs = media.filter((item) => item.kind === "document").length;
  const parts: string[] = [];
  if (photos > 0) {
    parts.push(`${photos} фото`);
  }
  if (videos > 0) {
    parts.push(`${videos} видео`);
  }
  if (docs > 0) {
    parts.push(`${docs} файл${docs === 1 ? "" : "ов"}`);
  }
  if (parts.length === 0) {
    parts.push(`${media.length} влож.`);
  }
  return hasText ? `${parts.join(" + ")} + текст` : parts.join(" + ");
}

function previewText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) {
    return "(без текста)";
  }
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
}

function shortTitle(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  if (flat.length <= 42) {
    return flat;
  }
  return `${flat.slice(0, 41)}…`;
}
