import type { Bot, Context } from "grammy";
import type { ChatMember } from "grammy/types";
import type { AdminAgent } from "../../agents/admin/admin.agent.js";
import type { ParentAgent } from "../../agents/parent/parent.agent.js";
import type { ParentHints } from "../../agents/parent/parent.hints.js";
import type { ChatRepository } from "../../platform/org/chat.repository.js";
import type { RabbitEventBus } from "../../infrastructure/rabbitmq/event-bus.js";
import type { TelegramMessenger } from "../../infrastructure/telegram/telegram.messenger.js";
import type { GigaChatSttService } from "../../infrastructure/stt/gigachat.stt.js";
import type { BotMembership } from "../../platform/org/types.js";
import type { StaffService } from "../../platform/identity/staff.service.js";
import type { StaffUser } from "../../platform/identity/types.js";
import { Ids } from "../../platform/shared/ids.js";
import type { ConversationStore } from "../../platform/conversation/conversation.store.js";
import type { OutboundMedia } from "../../platform/conversation/types.js";
import type { OutboundRepository } from "../../platform/messaging/outbound.repository.js";
import { yandexRouteFromCoordsUrl } from "../../platform/org/yandex-maps.js";
import type { KnowledgeGroundingService } from "../../platform/knowledge/knowledge-grounding.service.js";
import { AdminPanel, type BotReply } from "./admin.panel.js";
import { MENU_COMMANDS, parentLocationKeyboard } from "./keyboards.js";

export class TelegramAdminChannel {
  private readonly albumTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly messenger: TelegramMessenger,
    private readonly adminAgent: AdminAgent,
    private readonly parentAgent: ParentAgent,
    private readonly chats: ChatRepository,
    private readonly events: RabbitEventBus,
    private readonly staff: StaffService,
    private readonly panel: AdminPanel,
    private readonly conversations: ConversationStore,
    private readonly parentHints: ParentHints,
    private readonly stt: GigaChatSttService,
    private readonly knowledgeGrounding: KnowledgeGroundingService,
    private readonly outbound: OutboundRepository,
  ) {}

  get bot(): Bot {
    return this.messenger.bot;
  }

  register(): void {
    this.bot.catch((error) => {
      console.error("telegram", error);
    });

    this.bot.on("my_chat_member", async (ctx) => {
      await this.onMembership(ctx);
    });

    this.bot.on("message:new_chat_members", async (ctx) => {
      const me = ctx.me;
      const added = ctx.message.new_chat_members.some((member) => member.id === me.id);
      if (added) {
        await this.rememberChat(ctx, "member", false);
      }
    });

    this.bot.on("callback_query:data", async (ctx) => {
      const from = ctx.from;
      const telegramUserId = Ids.telegramUser(from.id);
      const data = ctx.callbackQuery.data;
      if (data.startsWith("p:")) {
        await ctx.answerCallbackQuery();
        try {
          const reply = await this.parentHints.handle(data, telegramUserId);
          const chatId = String(ctx.chat?.id ?? from.id);
          if (!reply) {
            await this.messenger.sendText(chatId, "Эта кнопка уже не действует.");
            return;
          }
          const inGroup = Boolean(ctx.chat && ctx.chat.type !== "private");
          if (inGroup) {
            const tagged = `${mentionMarkdown(from)}\n\n${reply.text}`;
            await this.messenger.sendText(chatId, tagged, reply.inline);
            return;
          }
          const messageId = ctx.callbackQuery.message?.message_id;
          if (messageId !== undefined && reply.inline) {
            const edited = await this.messenger.editText(chatId, messageId, reply.text, reply.inline);
            if (edited) {
              return;
            }
          }
          await this.messenger.sendText(chatId, reply.text, reply.inline);
        } catch (error) {
          console.error("parent callback", error);
          await this.messenger.sendText(String(ctx.chat?.id ?? from.id), "Не вышло. Напиши зал текстом.");
        }
        return;
      }
      if (ctx.chat && ctx.chat.type !== "private") {
        await ctx.answerCallbackQuery({ text: "Штаб — в личке" });
        return;
      }
      const user = await this.staff.resolveStaff(
        telegramUserId,
        from.username ?? null,
        [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
      );
      if (!user || !user.role) {
        await ctx.answerCallbackQuery({ text: "Нет доступа" });
        return;
      }
      await ctx.answerCallbackQuery();
      try {
        const reply = await this.panel.handleCallback(user, ctx.callbackQuery.data);
        const chatId = String(ctx.chat?.id ?? from.id);
        const messageId = ctx.callbackQuery.message?.message_id;
        if (reply.edit && messageId !== undefined) {
          const edited = await this.messenger.editText(chatId, messageId, reply.text, reply.inline);
          if (edited) {
            return;
          }
        }
        await this.deliver(chatId, reply);
      } catch (error) {
        console.error("callback", error);
        await this.messenger.sendText(
          String(ctx.chat?.id ?? from.id),
          error instanceof Error ? error.message : "Не вышло. Попробуй ещё раз.",
        );
      }
    });

    this.bot.on("message:photo", async (ctx) => {
      await this.onStaffMedia(ctx);
    });
    this.bot.on("message:video", async (ctx) => {
      await this.onStaffMedia(ctx);
    });
    this.bot.on("message:document", async (ctx) => {
      await this.onStaffMedia(ctx);
    });

    this.bot.on("message:voice", async (ctx) => {
      await this.onVoice(ctx);
    });

    this.bot.on("message:location", async (ctx) => {
      if (ctx.chat.type !== "private") {
        return;
      }
      const from = ctx.from;
      if (!from || from.is_bot) {
        return;
      }
      const telegramUserId = Ids.telegramUser(from.id);
      const user = await this.staff.resolveStaff(
        telegramUserId,
        from.username ?? null,
        [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
      );
      if (user?.role) {
        return;
      }
      const location = ctx.message.location;
      const address = await this.conversations.getRouteAddress(telegramUserId);
      const remove = { remove_keyboard: true } as const;
      if (!address || !location) {
        await this.messenger.sendText(
          String(ctx.chat.id),
          "Напиши зал — например Байконурская — и пришли гео ещё раз.",
          remove,
        );
        return;
      }
      const url = yandexRouteFromCoordsUrl(location.latitude, location.longitude, address);
      if (!url) {
        await this.messenger.sendText(String(ctx.chat.id), "Адрес зала пустой, маршрут не собрать.", remove);
        return;
      }
      await this.messenger.sendText(
        String(ctx.chat.id),
        `Маршрут от вас до **${address}**: [открыть в Яндекс.Картах](${url})`,
        remove,
      );
    });

    this.bot.on("message:text", async (ctx) => {
      const from = ctx.from;
      if (!from || from.is_bot) {
        return;
      }
      const telegramUserId = Ids.telegramUser(from.id);
      const username = from.username ?? null;
      const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ") || null;
      const chatId = String(ctx.chat.id);
      const isPrivate = ctx.chat.type === "private";
      const rawText = ctx.message.text;

      if (!isPrivate) {
        const addressed = isAddressedToBot(ctx);
        if (!addressed) {
          return;
        }
        const question = stripBotAddress(rawText, ctx.me.username ?? null);
        if (question.length === 0 || /^\/start\b/i.test(question)) {
          await this.messenger.sendText(chatId, GROUP_WELCOME, undefined, {
            replyToMessageId: ctx.message.message_id,
          });
          return;
        }
        const messageContext = await this.buildGroupMessageContext(ctx, chatId, question);
        const answer = await this.messenger.whileTyping(chatId, () =>
          this.parentAgent.handlePrivateText({
            telegramUserId,
            username,
            displayName,
            text: question,
            chatId,
            messageId: ctx.message.message_id,
            ...(messageContext ? { messageContext } : {}),
          }),
        );
        const dest = routeAddressFromText(answer.text);
        if (dest) {
          await this.conversations.setRouteAddress(telegramUserId, dest);
        }
        await this.messenger.sendText(chatId, answer.text, answer.inline, {
          replyToMessageId: ctx.message.message_id,
        });
        return;
      }

      await this.onPrivateText({
        telegramUserId,
        username,
        displayName,
        chatId,
        text: rawText,
        messageId: ctx.message.message_id,
      });
    });
  }

  private async onVoice(ctx: Context): Promise<void> {
    if (!ctx.chat || !ctx.from || ctx.from.is_bot || !ctx.message?.voice) {
      return;
    }
    const from = ctx.from;
    const telegramUserId = Ids.telegramUser(from.id);
    const username = from.username ?? null;
    const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ") || null;
    const chatId = String(ctx.chat.id);
    const isPrivate = ctx.chat.type === "private";
    const fileId = ctx.message.voice.file_id;
    const duration = ctx.message.voice.duration ?? 0;

    if (!this.stt.enabled) {
      if (isPrivate) {
        await this.messenger.sendText(chatId, "Голос пока выключен. Напиши текстом.");
      }
      return;
    }

    // В группах длинные голосовые не гоняем в STT — редко нужно и дорого.
    if (!isPrivate && duration > 45) {
      return;
    }

    try {
      const entities = await this.knowledgeGrounding.speechEntities();
      // В группе STT без «печатает» — иначе мигает на каждом чужом голосовом.
      // В личке — с индикатором, как обычный диалог.
      const { text } = isPrivate
        ? await this.messenger.whileTyping(chatId, () =>
            this.stt.transcribeTelegramFile(this.bot, fileId, { entities }),
          )
        : await this.stt.transcribeTelegramFile(this.bot, fileId, { entities });

      if (!isPrivate) {
        const replyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
        if (!replyToBot && !isSpokenAddressToBot(text)) {
          return;
        }
        const question = stripBotAddress(text, ctx.me.username ?? null);
        if (question.length < 2) {
          await this.messenger.sendText(chatId, GROUP_WELCOME, undefined, {
            replyToMessageId: ctx.message.message_id,
          });
          return;
        }
        const messageContext = await this.buildGroupMessageContext(ctx, chatId, question);
        const hits = await this.knowledgeGrounding.suggest(question);
        const grounded = this.knowledgeGrounding.formatForAgent(`[с голоса] ${question}`, hits);
        const answer = await this.messenger.whileTyping(chatId, () =>
          this.parentAgent.handlePrivateText({
            telegramUserId,
            username,
            displayName,
            text: grounded,
            chatId,
            messageId: ctx.message!.message_id,
            ...(messageContext ? { messageContext } : {}),
          }),
        );
        const dest = routeAddressFromText(answer.text);
        if (dest) {
          await this.conversations.setRouteAddress(telegramUserId, dest);
        }
        await this.messenger.sendText(chatId, answer.text, answer.inline, {
          replyToMessageId: ctx.message!.message_id,
        });
        return;
      }

      await this.messenger.sendText(chatId, `Распознал: «${text}»`);
      const hits = await this.knowledgeGrounding.suggest(text);
      const grounded = this.knowledgeGrounding.formatForAgent(`[с голоса] ${text}`, hits);
      await this.onPrivateText({
        telegramUserId,
        username,
        displayName,
        chatId,
        text: grounded,
        messageId: ctx.message!.message_id,
      });
    } catch (error) {
      console.error("voice stt", error);
      if (isPrivate) {
        await this.messenger.sendText(
          chatId,
          error instanceof Error ? error.message : "Не разобрал голос. Напиши текстом.",
        );
      }
    }
  }

  private async onPrivateText(input: {
    telegramUserId: string;
    username: string | null;
    displayName: string | null;
    chatId: string;
    text: string;
    messageId?: number;
  }): Promise<void> {
    const { telegramUserId, username, displayName, chatId, text, messageId } = input;

    if (this.staff.isMasterRecovery(text)) {
      const master = await this.staff.recoverMaster(telegramUserId, username, displayName);
      await this.deliver(chatId, this.panel.masterRecovered(master));
      return;
    }
    const user = await this.staff.resolveStaff(telegramUserId, username, displayName);
    if (/^\/start\b/i.test(text.trim())) {
      if (!user || !user.role) {
        await this.messenger.sendText(chatId, PRIVATE_WELCOME);
        return;
      }
      await this.deliver(chatId, this.panel.home(user));
      return;
    }
    if (!user || !user.role) {
      const answer = await this.messenger.whileTyping(chatId, () =>
        this.parentAgent.handlePrivateText({
          telegramUserId,
          username,
          displayName,
          text,
          chatId,
          ...(messageId !== undefined ? { messageId } : {}),
        }),
      );
      const dest = routeAddressFromText(answer.text);
      if (dest) {
        await this.conversations.setRouteAddress(telegramUserId, dest);
      }
      if (answer.inline) {
        await this.messenger.sendText(chatId, answer.text, answer.inline);
        return;
      }
      if (dest) {
        await this.messenger.sendText(chatId, answer.text, parentLocationKeyboard());
        return;
      }
      await this.messenger.sendText(chatId, answer.text);
      return;
    }

    await this.onStaffPrivateText(user, chatId, text, telegramUserId, username, displayName);
  }

  private async onStaffPrivateText(
    user: StaffUser,
    chatId: string,
    text: string,
    telegramUserId: string,
    username: string | null,
    displayName: string | null,
  ): Promise<void> {
    const menuReply = await this.panel.handleMenu(user, text);
    if (menuReply) {
      await this.deliver(chatId, menuReply);
      return;
    }

    const pendingReply = await this.panel.consumePendingUi(user, text);
    if (pendingReply) {
      await this.deliver(chatId, pendingReply);
      return;
    }

    const lowered = text.trim().toLowerCase();
    if (!MENU_COMMANDS.has(lowered)) {
      const answer = await this.messenger.whileTyping(chatId, () =>
        this.adminAgent.handlePrivateText({
          telegramUserId,
          username,
          displayName,
          text,
          user,
        }),
      );
      await this.deliver(chatId, await this.panel.withConfirmIfNeeded(user, answer));
    }
  }

  private async deliver(chatId: string, reply: BotReply): Promise<void> {
    await this.messenger.sendText(chatId, reply.text, reply.inline ?? reply.menu);
  }

  /**
   * Контекст для группового вопроса: reply на объявление и/или последние рассылки в этот чат.
   */
  private async buildGroupMessageContext(ctx: Context, chatId: string, question: string): Promise<string | undefined> {
    const parts: string[] = [];
    const replyText = extractRepliedMessageText(ctx);
    if (replyText) {
      parts.push(
        [
          "Родитель отвечает (reply) на это сообщение в чате — «это/когда/изменения» относятся к нему:",
          "-----",
          clipContext(replyText, 3500),
          "-----",
        ].join("\n"),
      );
    } else if (looksReferentialQuestion(question)) {
      const recent = await this.outbound.listRecentForChat(Ids.telegramChat(chatId), 3);
      const withText = recent.filter((item) => item.text.trim().length > 0);
      if (withText.length === 1 && withText[0]) {
        parts.push(
          [
            "Reply нет, но вопрос похож на отсылку к объявлению. Единственное недавнее объявление бота в ЭТОМ чате:",
            "-----",
            clipContext(withText[0].text, 3500),
            "-----",
          ].join("\n"),
        );
      } else if (withText.length > 1) {
        parts.push(
          [
            "Reply нет, вопрос похож на отсылку. Недавние объявления бота в ЭТОМ чате (от новых к старым):",
            ...withText.map((item, index) => {
              const preview = clipContext(item.text, 900);
              return `\n(${index + 1})\n${preview}`;
            }),
            "\nЕсли непонятно, к какому из них вопрос — коротко переспроси, к какому объявлению.",
          ].join("\n"),
        );
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  private async onStaffMedia(ctx: Context): Promise<void> {
    if (!ctx.chat || ctx.chat.type !== "private" || !ctx.from || ctx.from.is_bot || !ctx.message) {
      return;
    }
    const telegramUserId = Ids.telegramUser(ctx.from.id);
    const user = await this.staff.resolveStaff(
      telegramUserId,
      ctx.from.username ?? null,
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || null,
    );
    if (!user?.role) {
      return;
    }
    const item = mediaFromMessage(ctx);
    if (!item) {
      return;
    }
    const caption = "caption" in ctx.message && typeof ctx.message.caption === "string" ? ctx.message.caption : null;
    const mediaGroupId = "media_group_id" in ctx.message ? ctx.message.media_group_id : undefined;
    if (mediaGroupId) {
      await this.conversations.appendAlbumItem(telegramUserId, mediaGroupId, item, caption);
      const timerKey = `${telegramUserId}:${mediaGroupId}`;
      const previous = this.albumTimers.get(timerKey);
      if (previous) {
        clearTimeout(previous);
      }
      this.albumTimers.set(
        timerKey,
        setTimeout(() => {
          void this.finalizeAlbum(telegramUserId, mediaGroupId, String(ctx.chat!.id));
        }, 900),
      );
      return;
    }
    // Одно фото/видео = новый пакет, не дописываем к прошлой рассылке в буфере.
    await this.conversations.setPendingMedia(telegramUserId, {
      media: [item],
      caption: caption?.trim() || null,
      updatedAt: new Date().toISOString(),
    });
    await this.deliver(
      String(ctx.chat.id),
      await this.panel.mediaBroadcastPicker(user, { count: 1, caption: caption?.trim() || null }),
    );
  }

  private async finalizeAlbum(telegramUserId: string, mediaGroupId: string, chatId: string): Promise<void> {
    this.albumTimers.delete(`${telegramUserId}:${mediaGroupId}`);
    const album = await this.conversations.takeAlbum(telegramUserId, mediaGroupId);
    if (album.media.length === 0) {
      return;
    }
    await this.conversations.setPendingMedia(telegramUserId, {
      media: album.media.slice(0, 10),
      caption: album.caption || null,
      updatedAt: new Date().toISOString(),
    });
    const user = await this.staff.resolveStaff(telegramUserId, null, null);
    if (!user?.role) {
      await this.messenger.sendText(chatId, mediaAcceptedText(album.media.length, album.caption));
      return;
    }
    await this.deliver(
      chatId,
      await this.panel.mediaBroadcastPicker(user, {
        count: album.media.length,
        caption: album.caption || null,
      }),
    );
  }

  private async onMembership(ctx: Context): Promise<void> {
    const update = ctx.myChatMember;
    if (!update) {
      return;
    }
    const status = this.mapStatus(update.new_chat_member);
    const wasIn = isPresentMember(update.old_chat_member);
    const nowIn = status === "member" || status === "admin";
    await this.rememberChat(ctx, status, nowIn && !wasIn);
  }

  private async rememberChat(ctx: Context, status: BotMembership, greet = false): Promise<void> {
    const chat = ctx.chat;
    if (!chat || chat.type === "private") {
      return;
    }
    const telegramChatId = String(ctx.chatId);
    const title = "title" in chat ? chat.title : telegramChatId;
    const saved = await this.chats.upsertDiscovered({
      telegramChatId: Ids.telegramChat(telegramChatId),
      title,
      telegramType: chat.type,
      botStatus: status,
    });
    if (status === "member" || status === "admin") {
      await this.events.publish("chat.discovered", {
        telegramChatId: saved.telegramChatId,
        title: saved.title,
      });
    }
    if (greet && (status === "member" || status === "admin")) {
      await this.messenger.sendText(telegramChatId, GROUP_WELCOME);
    }
  }

  private mapStatus(member: ChatMember): BotMembership {
    if (member.status === "administrator") {
      return "admin";
    }
    if (member.status === "member" || member.status === "restricted") {
      return "member";
    }
    if (member.status === "left") {
      return "left";
    }
    if (member.status === "kicked") {
      return "kicked";
    }
    return "unknown";
  }
}

function mediaFromMessage(ctx: Context): OutboundMedia | null {
  const message = ctx.message;
  if (!message) {
    return null;
  }
  if ("photo" in message && message.photo && message.photo.length > 0) {
    const best = message.photo[message.photo.length - 1];
    return best ? { kind: "photo", fileId: best.file_id } : null;
  }
  if ("video" in message && message.video) {
    return { kind: "video", fileId: message.video.file_id };
  }
  if ("document" in message && message.document) {
    return { kind: "document", fileId: message.document.file_id };
  }
  return null;
}

function mediaAcceptedText(count: number, caption: string | null): string {
  const lines = [
    `Принял **${count}** вложени${count === 1 ? "е" : count < 5 ? "я" : "й"} в буфер рассылки.`,
    "Напиши куда отправить — например KolTech, филиал или «всем чатам».",
  ];
  if (caption && caption.trim().length > 0) {
    lines.push(`Подпись пока: ${caption.trim()}`);
  } else {
    lines.push("Текст объявления можно дописать следующим сообщением.");
  }
  return lines.join("\n");
}

function mentionMarkdown(from: { id: number; username?: string; first_name: string; last_name?: string }): string {
  if (from.username) {
    return `@${from.username}`;
  }
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || "вы";
  return `[${name}](tg://user?id=${from.id})`;
}

function isPresentMember(member: ChatMember): boolean {
  return member.status === "member" || member.status === "administrator" || member.status === "restricted";
}

const GROUP_WELCOME = `Привет! Я **Грифон** — помощник школы тхэквондо «Грифон».

**Зачем я здесь**
• Отвечаю родителям в этом чате и в личке: залы, расписание, тренеры, FAQ.
• Передаю объявления от администрации.

**Как со мной говорить**
• В группе: **ответьте на моё сообщение** или напишите **@** и выберите меня, потом вопрос. Так Telegram точно доставит текст.
• Можно начать с «Грифон, …», если у бота выключен Group Privacy.
• Голосом тоже можно: «Грифон, …» в начале или ответом на моё сообщение (нужен Group Privacy Off).
• В личке — просто напишите вопрос текстом или голосом.
• Штабу (рассылки, база, события) — в личку.

Если не знаю ответа — уточню у администрации и вернусь сюда.`;

const PRIVATE_WELCOME = `Привет! Я **Грифон** — помощник школы тхэквондо «Грифон».

Могу подсказать по залам, расписанию, тренерам, первому визиту, аттестациям и лагерю — из Базы Знаний школы.

Пишите обычным текстом, как человеку. Например: «как доехать на Байконурскую» или «кто тренеры». Можно и в групповом чате — упомяните меня или ответьте на моё сообщение.

Если ответа в базе нет — уточню у администрации и вернусь сюда.`;

function isAddressedToBot(ctx: Context): boolean {
  const me = ctx.me;
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }
  if (message.reply_to_message?.from?.id === me.id) {
    return true;
  }
  const entities = message.entities ?? [];
  for (const entity of entities) {
    if (entity.type === "mention") {
      const chunk = message.text.slice(entity.offset, entity.offset + entity.length).toLowerCase();
      if (me.username && chunk === `@${me.username.toLowerCase()}`) {
        return true;
      }
    }
    if (entity.type === "text_mention" && entity.user?.id === me.id) {
      return true;
    }
    if (entity.type === "bot_command" && entity.offset === 0) {
      return true;
    }
  }
  const lowered = message.text.toLowerCase();
  if (me.username && lowered.includes(`@${me.username.toLowerCase()}`)) {
    return true;
  }
  return /^(грифон|бот)([\s,!:-]|$)/i.test(message.text.trim());
}

/** После STT: обращение голосом «Грифон, …» / «Бот, …». */
function isSpokenAddressToBot(transcript: string): boolean {
  const trimmed = transcript.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return /^(грифон|бот|griffin)([\s,!:.\-]|$)/i.test(trimmed);
}

function stripBotAddress(text: string, botUsername: string | null): string {
  let next = text.trim();
  next = next.replace(/^\/\w+(@\w+)?\s*/i, "");
  if (botUsername) {
    next = next.replace(new RegExp(`@${botUsername}\\b`, "ig"), "");
  }
  next = next.replace(/^(грифон|бот|griffin)\s*[,!:.\-]?\s*/i, "");
  return next.replace(/\s+/g, " ").trim();
}

function extractRepliedMessageText(ctx: Context): string | null {
  const reply = ctx.message?.reply_to_message;
  if (!reply) {
    return null;
  }
  if ("text" in reply && typeof reply.text === "string" && reply.text.trim()) {
    return reply.text.trim();
  }
  if ("caption" in reply && typeof reply.caption === "string" && reply.caption.trim()) {
    return reply.caption.trim();
  }
  return null;
}

/** «А это когда?», «про это», короткие отсылки без явной темы. */
function looksReferentialQuestion(question: string): boolean {
  const t = question
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\[с голоса\]/g, " ")
    .trim();
  if (t.length === 0) {
    return false;
  }
  if (t.length <= 100 && /(^|\s)(это|эти|эта|этот|тут|там|выше|ниже)\b/.test(t)) {
    return true;
  }
  if (/когда\s+(это|изменения|начн|будет|вступ)/.test(t)) {
    return true;
  }
  if (/про\s+(это|объявлен|рассылк|цен)/.test(t)) {
    return true;
  }
  if (/^а\s+это\b/.test(t) || /^это\s+когда\b/.test(t)) {
    return true;
  }
  return false;
}

function clipContext(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function routeAddressFromText(text: string): string | null {
  const route = text.match(/yandex\.ru\/maps\/\?[^)\s]*rtext=~([^&\s)]+)/i);
  const encoded = route?.[1] ?? text.match(/yandex\.ru\/maps\/\?text=([^&\s)]+)/i)?.[1];
  if (!encoded) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.trim().length > 0 ? decoded : null;
  } catch {
    return encoded;
  }
}
