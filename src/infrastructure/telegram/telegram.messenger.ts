import { Bot } from "grammy";
import type {
  InlineKeyboardMarkup,
  InputMediaPhoto,
  InputMediaVideo,
  InputMediaDocument,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from "grammy/types";
import type { AppEnv } from "../../config/env.js";
import type { OutboundMedia } from "../../platform/conversation/types.js";
import { flattenTelegramMarkdown, markdownToTelegramHtml, splitTelegramText } from "./markdown.js";

export type SendResult = {
  chatId: string;
  ok: boolean;
  telegramMessageId: number | null;
  error: string | null;
};

export type ReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;

const CAPTION_LIMIT = 1024;

/**
 * Режем подпись только если реально не влезает в лимит Telegram (1024).
 * Без искусственного запаса — иначе режем то, что человек спокойно шлёт одной подписью.
 */
export function splitCaption(text: string, limit = CAPTION_LIMIT): { head: string | null; tail: string | null } {
  const trimmed = flattenTelegramMarkdown(text).trim();
  if (trimmed.length === 0) {
    return { head: null, tail: null };
  }
  if (trimmed.length <= limit) {
    return { head: trimmed, tail: null };
  }
  const slice = trimmed.slice(0, limit);
  const breakAt = Math.max(
    slice.lastIndexOf("\n\n"),
    slice.lastIndexOf("\n"),
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf(" "),
  );
  const cut = breakAt > limit * 0.5 ? breakAt + 1 : limit;
  const head = trimmed.slice(0, cut).trimEnd();
  const tail = trimmed.slice(cut).trimStart();
  if (head.length === 0) {
    return { head: trimmed.slice(0, limit), tail: trimmed.slice(limit).trimStart() || null };
  }
  return { head, tail: tail.length > 0 ? tail : null };
}

function isCaptionTooLongError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /caption is too long|CAPTION_TOO_LONG|message caption is too long/i.test(message);
}

export class TelegramMessenger {
  readonly bot: Bot;

  constructor(env: AppEnv) {
    this.bot = new Bot(env.TG_BOT_TOKEN);
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      await this.bot.api.sendChatAction(chatId, "typing");
    } catch {
      // чат мог удалить бота
    }
  }

  async whileTyping<T>(chatId: string, work: () => Promise<T>): Promise<T> {
    await this.sendTyping(chatId);
    const timer = setInterval(() => {
      void this.sendTyping(chatId);
    }, 4000);
    try {
      return await work();
    } finally {
      clearInterval(timer);
    }
  }

  async editText(chatId: string, messageId: number, text: string, markup?: ReplyMarkup): Promise<boolean> {
    const html = markdownToTelegramHtml(text);
    try {
      await this.bot.api.editMessageText(chatId, messageId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(markup ? { reply_markup: markup as InlineKeyboardMarkup } : {}),
      });
      return true;
    } catch {
      try {
        await this.bot.api.editMessageText(chatId, messageId, flattenTelegramMarkdown(text), {
          link_preview_options: { is_disabled: true },
          ...(markup ? { reply_markup: markup as InlineKeyboardMarkup } : {}),
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  async sendText(
    chatId: string,
    text: string,
    markup?: ReplyMarkup,
    options?: { replyToMessageId?: number },
  ): Promise<SendResult> {
    const chunks = splitTelegramText(flattenTelegramMarkdown(text));
    let lastId: number | null = null;
    try {
      for (const [index, chunk] of chunks.entries()) {
        const extra = index === chunks.length - 1 ? markup : undefined;
        const replyTo = index === 0 ? options?.replyToMessageId : undefined;
        lastId = await this.sendChunk(chatId, chunk, extra, replyTo);
      }
      return {
        chatId,
        ok: true,
        telegramMessageId: lastId,
        error: null,
      };
    } catch (error) {
      return {
        chatId,
        ok: false,
        telegramMessageId: null,
        error: error instanceof Error ? error.message : "Не смог отправить",
      };
    }
  }

  async sendOutbound(
    chatId: string,
    text: string,
    media: OutboundMedia[] = [],
  ): Promise<SendResult> {
    if (media.length === 0) {
      return this.sendText(chatId, text);
    }
    try {
      // Как у человека в клиенте: обычная подпись без HTML, целиком если влезает.
      const plain = flattenTelegramMarkdown(text).trim();
      try {
        const lastId =
          media.length === 1 && media[0]
            ? await this.sendSingleMedia(chatId, media[0], plain.length > 0 ? plain : null, false)
            : await this.sendAlbum(chatId, media, plain.length > 0 ? plain : null, false);
        return { chatId, ok: true, telegramMessageId: lastId, error: null };
      } catch (error) {
        if (!isCaptionTooLongError(error) || plain.length === 0) {
          throw error;
        }
        const { head, tail } = splitCaption(plain, CAPTION_LIMIT);
        const lastId =
          media.length === 1 && media[0]
            ? await this.sendSingleMedia(chatId, media[0], head, false)
            : await this.sendAlbum(chatId, media, head, false);
        if (tail) {
          const rest = await this.sendText(
            chatId,
            tail,
            undefined,
            lastId != null ? { replyToMessageId: lastId } : undefined,
          );
          if (!rest.ok) {
            return rest;
          }
          return { chatId, ok: true, telegramMessageId: rest.telegramMessageId, error: null };
        }
        return { chatId, ok: true, telegramMessageId: lastId, error: null };
      }
    } catch (error) {
      return {
        chatId,
        ok: false,
        telegramMessageId: null,
        error: error instanceof Error ? error.message : "Не смог отправить медиа",
      };
    }
  }

  private async sendSingleMedia(
    chatId: string,
    item: OutboundMedia,
    caption: string | null,
    asHtml: boolean,
  ): Promise<number> {
    const captionOpts =
      caption && caption.length > 0
        ? asHtml
          ? { caption: markdownToTelegramHtml(caption), parse_mode: "HTML" as const }
          : { caption }
        : {};
    if (item.kind === "photo") {
      const message = await this.bot.api.sendPhoto(chatId, item.fileId, captionOpts);
      return message.message_id;
    }
    if (item.kind === "video") {
      const message = await this.bot.api.sendVideo(chatId, item.fileId, captionOpts);
      return message.message_id;
    }
    const message = await this.bot.api.sendDocument(chatId, item.fileId, captionOpts);
    return message.message_id;
  }

  private async sendAlbum(
    chatId: string,
    media: OutboundMedia[],
    caption: string | null,
    asHtml: boolean,
  ): Promise<number> {
    const slice = media.slice(0, 10);
    const hasDoc = slice.some((item) => item.kind === "document");
    const hasAv = slice.some((item) => item.kind === "photo" || item.kind === "video");
    // Telegram не смешивает документы с фото/видео в одном media group.
    if (hasDoc && hasAv) {
      let lastId = 0;
      for (const [index, item] of slice.entries()) {
        lastId = await this.sendSingleMedia(chatId, item, index === 0 ? caption : null, asHtml);
      }
      return lastId;
    }

    const captionOpts =
      caption && caption.length > 0
        ? asHtml
          ? { caption: markdownToTelegramHtml(caption), parse_mode: "HTML" as const }
          : { caption }
        : {};

    if (hasDoc) {
      const group: InputMediaDocument[] = slice.map((item, index) => ({
        type: "document",
        media: item.fileId,
        ...(index === 0 ? captionOpts : {}),
      }));
      const messages = await this.bot.api.sendMediaGroup(chatId, group);
      return messages[messages.length - 1]?.message_id ?? messages[0]?.message_id ?? 0;
    }

    const group: Array<InputMediaPhoto | InputMediaVideo> = slice.map((item, index) => {
      if (item.kind === "video") {
        return {
          type: "video",
          media: item.fileId,
          ...(index === 0 ? captionOpts : {}),
        };
      }
      return {
        type: "photo",
        media: item.fileId,
        ...(index === 0 ? captionOpts : {}),
      };
    });
    const messages = await this.bot.api.sendMediaGroup(chatId, group);
    return messages[messages.length - 1]?.message_id ?? messages[0]?.message_id ?? 0;
  }

  private async sendChunk(
    chatId: string,
    text: string,
    markup?: ReplyMarkup,
    replyToMessageId?: number,
  ): Promise<number> {
    const html = markdownToTelegramHtml(text);
    const replyParams =
      replyToMessageId !== undefined ? { reply_parameters: { message_id: replyToMessageId } } : {};
    try {
      const message = await this.bot.api.sendMessage(chatId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...replyParams,
        ...(markup ? { reply_markup: markup } : {}),
      });
      return message.message_id;
    } catch {
      const message = await this.bot.api.sendMessage(chatId, flattenTelegramMarkdown(text), {
        link_preview_options: { is_disabled: true },
        ...replyParams,
        ...(markup ? { reply_markup: markup } : {}),
      });
      return message.message_id;
    }
  }
}
