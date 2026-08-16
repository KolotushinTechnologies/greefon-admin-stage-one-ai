import type { InlineKeyboard, Keyboard } from "grammy";
import type { ConversationStore } from "../../platform/conversation/conversation.store.js";
import { isMasterKolotushin } from "../../platform/identity/honorific.js";
import { MASTER_KOLOTUSHIN, hasAtLeast, type StaffRole, type StaffUser } from "../../platform/identity/types.js";
import type { StaffService } from "../../platform/identity/staff.service.js";
import type { ChatRepository } from "../../platform/org/chat.repository.js";
import type { ScheduleService } from "../../platform/org/schedule.service.js";
import type { KnowledgeService, KnowledgeUiCategory } from "../../platform/knowledge/knowledge.service.js";
import { KNOWLEDGE_UI_CATEGORIES } from "../../platform/knowledge/knowledge.service.js";
import { docFields, parseFieldLine } from "../../platform/knowledge/compose.js";
import type { KnowledgeDoc } from "../../platform/knowledge/types.js";
import type { SendService } from "../../platform/messaging/send.service.js";
import type { SchoolEventService } from "../../platform/events/event.service.js";
import type { SchoolEventKind } from "../../platform/events/types.js";
import type { EscalationService } from "../../platform/escalation/escalation.service.js";
import { ConfirmationRequiredError } from "../../platform/shared/errors.js";
import { confirmSendKeyboard, broadcastPickerKeyboard, mainMenuKeyboard, orgKeyboard, pageButtons, staffKeyboard } from "./keyboards.js";
import type { NotesService } from "../../platform/notes/notes.service.js";
import type { ChatAudience, ChatRecord } from "../../platform/org/types.js";

export type BotReply = {
  text: string;
  inline?: InlineKeyboard | undefined;
  menu?: Keyboard | undefined;
  edit?: boolean | undefined;
};

const PAGE = 8;

export class AdminPanel {
  constructor(
    private readonly staff: StaffService,
    private readonly chats: ChatRepository,
    private readonly schedule: ScheduleService,
    private readonly knowledge: KnowledgeService,
    private readonly conversations: ConversationStore,
    private readonly send: SendService,
    private readonly escalationService: EscalationService,
    private readonly schoolEvents: SchoolEventService,
    private readonly notes: NotesService,
  ) {}

  decorate(user: StaffUser, reply: BotReply): BotReply {
    const next: BotReply = { text: reply.text };
    if (reply.inline) {
      next.inline = reply.inline;
    }
    if (reply.edit) {
      next.edit = true;
    }
    next.menu = reply.menu ?? (user.role ? mainMenuKeyboard(user.role) : undefined);
    return next;
  }

  home(user: StaffUser): BotReply {
    const who = isMasterKolotushin(user)
      ? `Мастер, на связи. Расписание, чаты, рассылки, база, штат — жми или просто напиши.`
      : `Ты в кабинете Грифон Админ. Роль: **${roleLabel(user.role)}**. Можно писать живым языком или жать кнопки ниже.`;
    return this.decorate(user, { text: who });
  }

  masterRecovered(user: StaffUser): BotReply {
    return this.decorate(user, {
      text: "Мастер Колотушин, на связи. Доступ суперадмина вернул — пиши как обычно.",
    });
  }

  /** После фото/видео в буфер — селект чатов кнопками. */
  async mediaBroadcastPicker(
    user: StaffUser,
    input: { count: number; caption: string | null },
  ): Promise<BotReply> {
    return this.broadcastPickerScreen(user, 0, {
      intro: mediaBufferIntro(input.count, input.caption),
    });
  }

  private async broadcastPickerRoute(user: StaffUser, data: string): Promise<BotReply> {
    if (data === "bc" || data === "bc:p:0") {
      return this.broadcastPickerScreen(user, 0);
    }
    const pageMatch = /^bc:p:(\d+)$/.exec(data);
    if (pageMatch) {
      return this.broadcastPickerScreen(user, Number(pageMatch[1]));
    }
    const toggle = /^bc:t:(\d+):(.+)$/.exec(data);
    if (toggle?.[2]) {
      await this.conversations.toggleBroadcastTarget(user.telegramUserId, toggle[2]);
      return this.broadcastPickerScreen(user, Number(toggle[1] ?? "0"));
    }
    if (data === "bc:x") {
      await this.conversations.clearBroadcastTargets(user.telegramUserId);
      return this.broadcastPickerScreen(user, 0);
    }
    const audience = /^bc:a:(parents|coaches|all)$/.exec(data);
    if (audience?.[1]) {
      const chats = await this.listBroadcastableChats();
      const picked =
        audience[1] === "all"
          ? chats
          : chats.filter((chat) => chat.audience === (audience[1] as ChatAudience));
      await this.conversations.setBroadcastTargets(
        user.telegramUserId,
        picked.map((chat) => chat._id),
      );
      return this.broadcastPickerScreen(user, 0);
    }
    if (data === "bc:go") {
      return this.sendBroadcastSelection(user);
    }
    return this.broadcastPickerScreen(user, 0);
  }

  private async broadcastPickerScreen(
    user: StaffUser,
    page: number,
    opts: { intro?: string } = {},
  ): Promise<BotReply> {
    const draft = await this.conversations.getPendingMedia(user.telegramUserId);
    if (!draft || draft.media.length === 0) {
      return this.decorate(user, {
        text: "В буфере пусто. Пришли фото/видео — появятся кнопки выбора чатов.",
      });
    }
    const chats = await this.listBroadcastableChats();
    const selected = new Set(await this.conversations.getBroadcastTargets(user.telegramUserId));
    const pageCount = Math.max(1, Math.ceil(chats.length / PAGE));
    const safePage = Math.min(Math.max(0, page), pageCount - 1);
    const slice = chats.slice(safePage * PAGE, safePage * PAGE + PAGE);
    const selectedTitles = chats.filter((chat) => selected.has(chat._id)).map((chat) => chat.title);
    const lines = [
      opts.intro ?? mediaBufferIntro(draft.media.length, draft.caption),
      "",
      selected.size > 0
        ? `Выбрано **${selected.size}**: ${selectedTitles.slice(0, 6).join(", ")}${selectedTitles.length > 6 ? "…" : ""}`
        : "Отметь чаты галочками или пресетом (родительские / тренерские / все). Можно и текстом/голосом.",
      chats.length > PAGE ? `Стр. ${safePage + 1}/${pageCount}` : null,
    ].filter((line): line is string => Boolean(line));
    return this.decorate(user, {
      text: lines.join("\n"),
      inline: broadcastPickerKeyboard({
        chats: slice.map((chat) => ({
          id: chat._id,
          title: chat.title,
          selected: selected.has(chat._id),
        })),
        page: safePage,
        pageCount,
        selectedCount: selected.size,
      }),
    });
  }

  private async sendBroadcastSelection(user: StaffUser): Promise<BotReply> {
    const draft = await this.conversations.getPendingMedia(user.telegramUserId);
    if (!draft || draft.media.length === 0) {
      return this.decorate(user, { text: "Буфер пуст — нечего отправлять." });
    }
    const selectedIds = await this.conversations.getBroadcastTargets(user.telegramUserId);
    if (selectedIds.length === 0) {
      return this.broadcastPickerScreen(user, 0, {
        intro: "Сначала отметь хотя бы один чат (или пресет).",
      });
    }
    const all = await this.listBroadcastableChats();
    const byId = new Map(all.map((chat) => [chat._id, chat]));
    const chats = selectedIds.map((id) => byId.get(id)).filter((chat): chat is ChatRecord => Boolean(chat));
    if (chats.length === 0) {
      await this.conversations.clearBroadcastTargets(user.telegramUserId);
      return this.broadcastPickerScreen(user, 0, { intro: "Выбранные чаты уже недоступны — выбери заново." });
    }
    const text = (draft.caption ?? "").trim();
    try {
      const message = await this.send.sendToChatsNow({
        actorTelegramId: user.telegramUserId,
        text,
        chats,
        media: draft.media,
      });
      await this.conversations.takePendingMedia(user.telegramUserId);
      await this.conversations.clearBroadcastTargets(user.telegramUserId);
      return this.decorate(user, { text: message });
    } catch (error) {
      return this.decorate(user, {
        text: error instanceof Error ? error.message : "Не отправил.",
      });
    }
  }

  private async listBroadcastableChats(): Promise<ChatRecord[]> {
    const chats = await this.chats.listAll();
    return chats
      .filter((chat) => chat.botStatus === "member" || chat.botStatus === "admin")
      .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }

  async handleMenu(user: StaffUser, command: string): Promise<BotReply | null> {
    const key = command.trim().toLowerCase();
    switch (key) {
      case "меню":
      case "/start":
      case "/menu":
        return this.home(user);
      case "расписание":
        return this.scheduleBranches(user);
      case "чаты":
        return this.chatsRoot(user);
      case "написать":
        await this.conversations.setPendingUi(user.telegramUserId, { kind: "broadcast_text" });
        return this.decorate(user, {
          text: "Напиши текст объявления следующим сообщением. Куда слать — уточню, если будет неочевидно.",
        });
      case "база знаний":
        return this.knowledgeList(user);
      case "темы":
        return this.knowledgeCategory(user, "topic", 0);
      case "филиалы":
        return this.filialsRoot(user);
      case "события":
        if (!hasAtLeast(user.role, "admin")) {
          return this.decorate(user, { text: "События заводят админ и суперадмин." });
        }
        return this.eventsScreen(user);
      case "штат":
        if (!hasAtLeast(user.role, "superadmin")) {
          return this.decorate(user, { text: "Штат может смотреть только суперадмин." });
        }
        return this.decorate(user, {
          text: await this.staffText(user),
          inline: staffKeyboard(),
        });
      case "заметки":
        if (!hasAtLeast(user.role, "superadmin")) {
          return this.decorate(user, { text: "Заметки только для суперадмина." });
        }
        return this.notesList(user);
      default:
        return null;
    }
  }

  async handleCallback(user: StaffUser, data: string): Promise<BotReply> {
    const denied = this.denyIfNeeded(user, minRoleForCallback(data));
    if (denied) {
      return denied;
    }
    if (data === "bc" || data.startsWith("bc:")) {
      const reply = await this.broadcastPickerRoute(user, data);
      reply.edit = true;
      return reply;
    }
    const screen = await this.routeScreen(user, data);
    if (screen) {
      screen.edit = true;
      return screen;
    }
    const sendYes = /^send:y:(.+)$/.exec(data);
    if (sendYes?.[1]) {
      return this.decorate(user, {
        text: await this.send.confirmPending(user.telegramUserId, true, sendYes[1]),
      });
    }
    if (data === "send:yes") {
      return this.decorate(user, { text: await this.send.confirmPending(user.telegramUserId, true) });
    }
    const sendNo = /^send:n:(.+)$/.exec(data);
    if (sendNo?.[1] || data === "send:no") {
      return this.decorate(user, { text: await this.send.confirmPending(user.telegramUserId, false) });
    }
    const take = /^e:c:(.+)$/.exec(data);
    if (take?.[1]) {
      const prompt = await this.escalationService.claim(user, take[1]);
      await this.conversations.setPendingUi(user.telegramUserId, { kind: "escalate_answer", escalationId: take[1] });
      return this.decorate(user, { text: prompt });
    }
    if (data === "staff:list") {
      return this.decorate(user, { text: await this.staffText(user), inline: staffKeyboard() });
    }
    if (data === "notes" || data.startsWith("notes:")) {
      const reply = await this.notesRoute(user, data);
      reply.edit = true;
      return reply;
    }
    if (data === "staff:assign:admin") {
      await this.conversations.setPendingUi(user.telegramUserId, { kind: "assign_role", role: "admin" });
      return this.decorate(user, {
        text: "Пришли username или telegram id человека, которого сделать **админом**. Пусть он сначала напишет боту.",
      });
    }
    if (data === "staff:assign:superadmin") {
      await this.conversations.setPendingUi(user.telegramUserId, { kind: "assign_role", role: "superadmin" });
      return this.decorate(user, {
        text: "Пришли username или telegram id человека, которого сделать **суперадмином**.",
      });
    }
    if (data === "staff:revoke") {
      await this.conversations.setPendingUi(user.telegramUserId, { kind: "revoke_role" });
      return this.decorate(user, {
        text: "Пришли username или telegram id, у кого забрать доступ.",
      });
    }
    if (data === "kb:search") {
      return this.knowledgeList(user);
    }
    if (data === "kb:add") {
      return this.decorate(user, {
        text: "Напиши «запомни, что…» — новая карточка. Или открой карточку и жми **+ поле**. Живым языком тоже можно: «добавь Маитову дан I».",
      });
    }
    if (data === "kb:topics") {
      return this.topicsList(user);
    }
    if (data === "org:branches") {
      return this.filialsRoot(user);
    }
    if (data === "org:instructors") {
      return this.instructorsScreen(user);
    }
    if (data === "org:groups") {
      return this.scheduleBranches(user);
    }
    if (data === "org:sync") {
      return this.decorate(user, {
        text: "Во внешние кабинеты больше не ходим. Филиалы, тренеры и расписание правятся в **Базе знаний**.",
        inline: orgKeyboard(),
      });
    }
    if (data === "v" || data === "v:l") {
      return this.eventsScreen(user);
    }
    if (data === "v:a") {
      await this.conversations.setPendingUi(user.telegramUserId, { kind: "event_add" });
      return this.decorate(user, {
        text: "Напиши событие так: **аттестация 12 мая, Энгельса, цветные пояса** или **лагерь 1–14 июля, 8–12 лет**.",
      });
    }
    const closeEvent = /^v:x:(.+)$/.exec(data);
    if (closeEvent?.[1]) {
      try {
        await this.schoolEvents.close(closeEvent[1], user.telegramUserId);
      } catch (error) {
        return this.decorate(user, { text: error instanceof Error ? error.message : "Не закрыл." });
      }
      return this.eventsScreen(user);
    }
    return this.home(user);
  }

  private async routeScreen(user: StaffUser, data: string): Promise<BotReply | null> {
    if (data === "s" || data.startsWith("s:")) {
      return this.scheduleRoute(user, data);
    }
    if (data === "c" || data.startsWith("c:")) {
      return this.chatsRoute(user, data);
    }
    if (data === "f" || data.startsWith("f:")) {
      return this.filialsRoute(user, data);
    }
    if (data === "k" || data.startsWith("k:")) {
      return this.knowledgeRoute(user, data);
    }
    return null;
  }

  private async scheduleRoute(user: StaffUser, data: string): Promise<BotReply> {
    if (data === "s") {
      return this.scheduleBranches(user);
    }
    const branchMatch = /^s:b:([^:]+)(?::(\d+))?$/.exec(data);
    if (branchMatch?.[1]) {
      return this.scheduleGroups(user, branchMatch[1], Number(branchMatch[2] ?? "0"));
    }
    const groupMatch = /^s:g:(.+)$/.exec(data);
    if (groupMatch?.[1]) {
      return this.scheduleGroupCard(user, groupMatch[1]);
    }
    const writeMatch = /^s:w:(.+)$/.exec(data);
    if (writeMatch?.[1]) {
      const card = await this.knowledge.getActive(writeMatch[1]);
      const groupId = card?.groupId ?? writeMatch[1];
      await this.conversations.setPendingUi(user.telegramUserId, { kind: "broadcast_group", groupId });
      return this.decorate(user, { text: "Пиши текст — уйдёт в чат этой группы, если он размечен." });
    }
    const editMatch = /^s:e:(.+)$/.exec(data);
    if (editMatch?.[1]) {
      await this.conversations.setPendingUi(user.telegramUserId, { kind: "edit_schedule", groupId: editMatch[1] });
      return this.decorate(user, {
        text: "Напиши, что поменять. Например: `вторник и четверг 18:00` или просто `11:00`.",
      });
    }
    return this.scheduleBranches(user);
  }

  private async scheduleBranches(user: StaffUser): Promise<BotReply> {
    const branches = await this.knowledge.listBranchCards();
    return this.decorate(user, {
      text: "Какой филиал?",
      inline: pageButtons(
        branches.map((branch) => ({ text: branch.title, data: `s:b:${branch._id}` })),
        [{ text: "Все филиалы", data: "f" }],
      ),
    });
  }

  private async scheduleGroups(user: StaffUser, branchKey: string, page: number): Promise<BotReply> {
    const branch = await this.findBranchCard(branchKey);
    const groups = (await this.knowledge.listScheduleCards())
      .filter((item) => scheduleBelongsToBranch(item, branch))
      .sort((a, b) => a.title.localeCompare(b.title, "ru"));
    const slice = groups.slice(page * PAGE, page * PAGE + PAGE);
    const nav: Array<{ text: string; data: string }> = [{ text: "← Филиалы", data: "s" }];
    if (page > 0) {
      nav.push({ text: "←", data: `s:b:${branchKey}:${page - 1}` });
    }
    if ((page + 1) * PAGE < groups.length) {
      nav.push({ text: "→", data: `s:b:${branchKey}:${page + 1}` });
    }
    return this.decorate(user, {
      text: `**${branch?.title ?? "Филиал"}**\nГрупп: ${groups.length}. Выбери.`,
      inline: pageButtons(
        slice.map((group) => ({ text: fieldOf(group, "группа") || group.title, data: `s:g:${group._id}` })),
        nav,
      ),
    });
  }

  private async scheduleGroupCard(user: StaffUser, docId: string): Promise<BotReply> {
    const group = await this.knowledge.getActive(docId);
    if (!group || group.kind !== "schedule") {
      return this.decorate(user, { text: "Эту группу уже не вижу." });
    }
    const branchKey = group.branchId ?? fieldOf(group, "филиал") ?? "";
    const actions: Array<{ text: string; data: string }> = [
      { text: "Написать в чат", data: `s:w:${group._id}` },
      { text: "Поправить", data: `s:e:${group._id}` },
      { text: "← К группам", data: branchKey ? `s:b:${group.branchId ?? branchKey}` : "s" },
    ];
    return this.decorate(user, {
      text: this.schedule.formatDoc(group),
      inline: pageButtons([], actions),
    });
  }

  private async chatsRoute(user: StaffUser, data: string): Promise<BotReply> {
    if (data === "c") {
      return this.chatsRoot(user);
    }
    if (data === "c:u") {
      return this.chatsUnlabeled(user);
    }
    const branchMatch = /^c:b:([^:]+)(?::(\d+))?$/.exec(data);
    if (branchMatch?.[1]) {
      return this.chatsInBranch(user, branchMatch[1], Number(branchMatch[2] ?? "0"));
    }
    const chatMatch = /^c:i:(.+)$/.exec(data);
    if (chatMatch?.[1]) {
      return this.chatCard(user, chatMatch[1]);
    }
    const writeChat = /^c:w:(.+)$/.exec(data);
    if (writeChat?.[1]) {
      await this.conversations.setPendingUi(user.telegramUserId, { kind: "broadcast_chat", chatId: writeChat[1] });
      return this.decorate(user, { text: "Пиши текст — уйдёт в этот чат." });
    }
    return this.chatsRoot(user);
  }

  private async chatsRoot(user: StaffUser): Promise<BotReply> {
    const chats = await this.chats.listAll();
    if (chats.length === 0) {
      return this.decorate(user, {
        text: "Рабочих чатов пока нет. Добавь бота в группы — подхвачу.",
      });
    }
    const unlabeled = chats.filter((chat) => !chat.branchId).length;
    const branches = await this.knowledge.listBranchCards();
    const items = [
      ...(unlabeled > 0 ? [{ text: `Без метки (${unlabeled})`, data: "c:u" }] : []),
      ...branches
        .map((branch) => ({
          branch,
          count: chats.filter((chat) => chat.branchId && (chat.branchId === branch.branchId || chat.branchId === branch._id))
            .length,
        }))
        .filter((item) => item.count > 0)
        .map((item) => ({
          text: `${item.branch.title} (${item.count})`,
          data: `c:b:${item.branch.branchId ?? item.branch._id}`,
        })),
    ];
    return this.decorate(user, {
      text: `Чатов: ${chats.length}. Куда смотрим?`,
      inline: pageButtons(items),
    });
  }

  private async chatsUnlabeled(user: StaffUser): Promise<BotReply> {
    const chats = (await this.chats.listAll()).filter((chat) => !chat.branchId);
    return this.decorate(user, {
      text: "Эти ещё не размечены.",
      inline: pageButtons(
        chats.map((chat) => ({ text: chat.title, data: `c:i:${chat._id}` })),
        [{ text: "← Чаты", data: "c" }],
      ),
    });
  }

  private async chatsInBranch(user: StaffUser, branchId: string, page: number): Promise<BotReply> {
    const branch = await this.findBranchCard(branchId);
    const chats = (await this.chats.findByFilter({ branchId: branch?.branchId ?? branchId })).sort((a, b) =>
      a.title.localeCompare(b.title, "ru"),
    );
    const slice = chats.slice(page * PAGE, page * PAGE + PAGE);
    const nav: Array<{ text: string; data: string }> = [{ text: "← Чаты", data: "c" }];
    if (page > 0) {
      nav.push({ text: "←", data: `c:b:${branchId}:${page - 1}` });
    }
    if ((page + 1) * PAGE < chats.length) {
      nav.push({ text: "→", data: `c:b:${branchId}:${page + 1}` });
    }
    return this.decorate(user, {
      text: `**${branch?.title ?? "Филиал"}** · чаты`,
      inline: pageButtons(
        slice.map((chat) => ({ text: `${chat.title} · ${chat.audience}`, data: `c:i:${chat._id}` })),
        nav,
      ),
    });
  }

  private async chatCard(user: StaffUser, id: string): Promise<BotReply> {
    const chat = await this.chats.findById(id);
    if (!chat) {
      return this.decorate(user, { text: "Чат не нашёл." });
    }
    const branch = chat.branchId ? await this.findBranchCard(chat.branchId) : null;
    const group = chat.groupId
      ? (await this.knowledge.listScheduleCards()).find((item) => item.groupId === chat.groupId)
      : null;
    return this.decorate(user, {
      text: [
        `**${chat.title}**`,
        `аудитория: ${chat.audience}`,
        `филиал: ${branch?.title ?? "не размечен"}`,
        `группа: ${group ? (fieldOf(group, "группа") ?? group.title) : "—"}`,
      ].join("\n"),
      inline: pageButtons([], [
        { text: "Написать", data: `c:w:${chat._id}` },
        { text: "← Назад", data: chat.branchId ? `c:b:${chat.branchId}` : "c:u" },
      ]),
    });
  }

  private async filialsRoute(user: StaffUser, data: string): Promise<BotReply> {
    if (data === "f") {
      return this.filialsRoot(user);
    }
    if (data === "org:sync" || data === "f:sync") {
      return this.decorate(user, {
        text: "Во внешние кабинеты больше не ходим. Меняй карточки в **Базе знаний**.",
        inline: orgKeyboard(),
      });
    }
    const write = /^f:w:(.+)$/.exec(data);
    if (write?.[1]) {
      await this.conversations.setPendingUi(user.telegramUserId, { kind: "broadcast_branch", branchId: write[1] });
      return this.decorate(user, { text: "Пиши текст — уйдёт в чаты этого филиала." });
    }
    const card = /^f:i:(.+)$/.exec(data);
    if (card?.[1]) {
      return this.filialCard(user, card[1]);
    }
    if (data === "org:instructors") {
      return this.instructorsScreen(user);
    }
    return this.filialsRoot(user);
  }

  private async filialsRoot(user: StaffUser): Promise<BotReply> {
    const branches = await this.knowledge.listBranchCards();
    return this.decorate(user, {
      text: "Филиалы. Жми, чтобы открыть группы.",
      inline: pageButtons(
        branches.map((branch) => ({ text: branch.title, data: `f:i:${branch._id}` })),
        [
          { text: "Тренеры", data: "org:instructors" },
          { text: "База знаний", data: "k" },
        ],
      ),
    });
  }

  private async filialCard(user: StaffUser, branchKey: string): Promise<BotReply> {
    const branch = await this.findBranchCard(branchKey);
    if (!branch) {
      return this.decorate(user, { text: "Филиал не нашёл." });
    }
    const groups = (await this.knowledge.listScheduleCards()).filter((item) => scheduleBelongsToBranch(item, branch));
    const facts = docFields(branch.fields)
      .map((field) => `• **${field.key}:** ${field.value}`)
      .join("\n");
    const orgId = branch.branchId ?? branch._id;
    return this.decorate(user, {
      text: `**${branch.title}**\n${facts || "_полей пока нет_"}\n\nГрупп в базе: ${groups.length}`,
      inline: pageButtons([], [
        { text: "Расписание групп", data: `s:b:${branch._id}` },
        { text: "Чаты филиала", data: `c:b:${orgId}` },
        { text: "Написать филиалу", data: `f:w:${orgId}` },
        { text: "← Филиалы", data: "f" },
      ]),
    });
  }

  private async instructorsScreen(user: StaffUser): Promise<BotReply> {
    const instructors = await this.knowledge.listStaffProfiles();
    const names = instructors.map((item) => `• ${item.title}`);
    return this.decorate(user, {
      text: `**Тренеры**\n\n${names.join("\n")}`,
      inline: pageButtons([], [{ text: "← Филиалы", data: "f" }]),
    });
  }

  private async eventsScreen(user: StaffUser): Promise<BotReply> {
    const events = await this.schoolEvents.listUpcoming();
    const lines =
      events.length > 0 ? events.map((item) => this.schoolEvents.format(item)).join("\n\n") : "Ближайших дат нет.";
    return this.decorate(user, {
      text: `**События**\n\n${lines}`,
      inline: pageButtons(
        events.map((item) => ({ text: `Закрыть · ${item.title}`, data: `v:x:${item._id}` })),
        [{ text: "Добавить", data: "v:a" }],
      ),
    });
  }

  private async knowledgeRoute(user: StaffUser, data: string): Promise<BotReply> {
    if (data === "k" || data === "kb:search") {
      return this.knowledgeList(user);
    }
    if (data === "k:t" || data === "kb:topics") {
      return this.knowledgeCategory(user, "topic", 0);
    }
    const categoryMatch = /^k:c:([a-z]+):(\d+)$/.exec(data);
    if (categoryMatch?.[1] && categoryMatch[2] !== undefined) {
      const category = parseKnowledgeCategory(categoryMatch[1]);
      if (category) {
        return this.knowledgeCategory(user, category, Number(categoryMatch[2]));
      }
    }
    if (data === "kb:add" || data === "k:a") {
      return this.decorate(user, {
        text: "Напиши «запомни, что…» — новая карточка. В карточке можно добавить или убрать отдельные поля.\nЛюдей сохраняй как FAQ с полем роль: тренер, темы родителям — kind topic.",
      });
    }
    const addField = /^k:p:(.+)$/.exec(data);
    if (addField?.[1]) {
      await this.conversations.setPendingUi(user.telegramUserId, {
        kind: "kb_field",
        docId: addField[1],
        fieldIndex: null,
      });
      return this.decorate(user, {
        text: "Напиши поле так: **дан: I дан** или **телефон: +7 …**",
      });
    }
    const fieldCard = /^k:f:([^:]+):(\d+)$/.exec(data);
    if (fieldCard?.[1] && fieldCard[2] !== undefined) {
      return this.knowledgeFieldCard(user, fieldCard[1], Number(fieldCard[2]));
    }
    const editField = /^k:e:([^:]+):(\d+)$/.exec(data);
    if (editField?.[1] && editField[2] !== undefined) {
      await this.conversations.setPendingUi(user.telegramUserId, {
        kind: "kb_field",
        docId: editField[1],
        fieldIndex: Number(editField[2]),
      });
      return this.decorate(user, { text: "Новое значение следующим сообщением." });
    }
    const unsetField = /^k:u:([^:]+):(\d+)$/.exec(data);
    if (unsetField?.[1] && unsetField[2] !== undefined) {
      try {
        await this.knowledge.removeField({
          id: unsetField[1],
          index: Number(unsetField[2]),
          actorTelegramId: user.telegramUserId,
        });
      } catch (error) {
        return this.decorate(user, { text: error instanceof Error ? error.message : "Не убрал поле." });
      }
      return this.knowledgeCard(user, unsetField[1]);
    }
    const open = /^k:i:(.+)$/.exec(data);
    if (open?.[1]) {
      return this.knowledgeCard(user, open[1]);
    }
    const drop = /^k:d:(.+)$/.exec(data);
    if (drop?.[1]) {
      try {
        await this.knowledge.remove(drop[1], user.telegramUserId);
      } catch (error) {
        return this.decorate(user, { text: error instanceof Error ? error.message : "Не удалил." });
      }
      return this.knowledgeList(user);
    }
    return this.knowledgeList(user);
  }

  private async knowledgeList(user: StaffUser): Promise<BotReply> {
    await this.knowledge.repairMisclassifiedPeople(user.telegramUserId).catch(() => 0);
    await this.knowledge.ensureMasterDocsHidden().catch(() => 0);
    const counts = await this.knowledge.categoryCounts({ excludeNamespaces: hiddenNamespaces(user) });
    const items = KNOWLEDGE_UI_CATEGORIES.filter((item) => counts[item.id] > 0 || item.id === "topic").map((item) => ({
      text: `${item.title} · ${counts[item.id]}`,
      data: `k:c:${item.id}:0`,
    }));
    const nav = hasAtLeast(user.role, "admin")
      ? [{ text: "Добавить", data: "k:a" }]
      : [];
    return this.decorate(user, {
      text: "База знаний — выбери раздел:",
      inline: pageButtons(items, nav),
    });
  }

  private async knowledgeCategory(user: StaffUser, category: KnowledgeUiCategory, page: number): Promise<BotReply> {
    if (category === "topic") {
      await this.knowledge.repairMisclassifiedPeople(user.telegramUserId).catch(() => 0);
    }
    const docs = await this.knowledge.listByCategory(category, { excludeNamespaces: hiddenNamespaces(user) });
    const label = KNOWLEDGE_UI_CATEGORIES.find((item) => item.id === category)?.title ?? category;
    if (docs.length === 0) {
      return this.decorate(user, {
        text: `**${label}**\nПока пусто.`,
        inline: pageButtons([], [{ text: "← Разделы", data: "k" }]),
      });
    }
    const safePage = Math.max(0, Math.min(page, Math.floor((docs.length - 1) / PAGE)));
    const slice = docs.slice(safePage * PAGE, safePage * PAGE + PAGE);
    const nav: Array<{ text: string; data: string }> = [{ text: "← Разделы", data: "k" }];
    if (safePage > 0) {
      nav.push({ text: "←", data: `k:c:${category}:${safePage - 1}` });
    }
    if ((safePage + 1) * PAGE < docs.length) {
      nav.push({ text: "→", data: `k:c:${category}:${safePage + 1}` });
    }
    return this.decorate(user, {
      text: `**${label}** (${docs.length})\nСтр. ${safePage + 1}/${Math.max(1, Math.ceil(docs.length / PAGE))}`,
      inline: pageButtons(
        slice.map((doc) => ({ text: doc.title, data: `k:i:${doc._id}` })),
        nav,
      ),
    });
  }

  private async knowledgeCard(user: StaffUser, id: string): Promise<BotReply> {
    const doc = await this.knowledge.getActive(id);
    if (!doc || doc.namespace === "internal" || hiddenNamespaces(user).includes(doc.namespace as "internal")) {
      return this.decorate(user, { text: "Запись не нашёл." });
    }
    const fields = docFields(doc.fields);
    const facts =
      fields.length > 0 ? fields.map((field) => `• **${field.key}:** ${field.value}`).join("\n") : "_полей пока нет_";
    const body = doc.body.trim().length > 0 ? `\n\n${doc.body}` : "";
    const canEdit = hasAtLeast(user.role, "admin");
    const extras = canEdit
      ? [
          { text: "+ поле", data: `k:p:${doc._id}` },
          { text: "Удалить карточку", data: `k:d:${doc._id}` },
          { text: "← База", data: "k" },
        ]
      : [{ text: "← База", data: "k" }];
    return this.decorate(user, {
      text: `**${doc.title}**\n\n${facts}${body}`,
      inline: pageButtons(
        canEdit ? fields.map((field, index) => ({ text: field.key, data: `k:f:${doc._id}:${index}` })) : [],
        extras,
      ),
    });
  }

  private async knowledgeFieldCard(user: StaffUser, id: string, index: number): Promise<BotReply> {
    const doc = await this.knowledge.getActive(id);
    if (doc && hiddenNamespaces(user).includes(doc.namespace as "internal")) {
      return this.decorate(user, { text: "Поле не нашёл." });
    }
    const field = doc ? docFields(doc.fields)[index] : undefined;
    if (!doc || !field) {
      return this.decorate(user, { text: "Поле не нашёл." });
    }
    return this.decorate(user, {
      text: `**${doc.title}** · ${field.key}\n\n${field.value}`,
      inline: pageButtons([], [
        { text: "Изменить", data: `k:e:${doc._id}:${index}` },
        { text: "Удалить поле", data: `k:u:${doc._id}:${index}` },
        { text: "← Карточка", data: `k:i:${doc._id}` },
      ]),
    });
  }

  private async topicsList(user: StaffUser): Promise<BotReply> {
    return this.knowledgeCategory(user, "topic", 0);
  }

  async consumePendingUi(user: StaffUser, text: string): Promise<BotReply | null> {
    const state = await this.conversations.load(user.telegramUserId);
    if (!state.pendingUi) {
      return null;
    }
    const pending = state.pendingUi;
    const pendingDenied = this.denyIfNeeded(user, minRoleForPending(pending.kind));
    if (pendingDenied) {
      await this.conversations.setPendingUi(user.telegramUserId, null);
      return pendingDenied;
    }
    await this.conversations.setPendingUi(user.telegramUserId, null);
    const target = parseStaffTarget(text);
    try {
      if (pending.kind === "assign_role") {
        const updated = await this.staff.assignRole(user, target, pending.role);
        return this.decorate(user, {
          text: `Готово. ${updated.username ? `@${updated.username}` : updated.telegramUserId} теперь **${roleLabel(updated.role)}**.`,
          inline: staffKeyboard(),
        });
      }
      if (pending.kind === "revoke_role") {
        await this.staff.revoke(user, target);
        return this.decorate(user, {
          text: "Доступ забрал.",
          inline: staffKeyboard(),
        });
      }
      if (pending.kind === "escalate_answer") {
        return this.decorate(user, {
          text: await this.escalationService.resolve(user, pending.escalationId, text),
        });
      }
      if (pending.kind === "broadcast_text") {
        return null;
      }
      if (pending.kind === "broadcast_chat") {
        const chat = await this.chats.findById(pending.chatId);
        if (!chat) {
          return this.decorate(user, { text: "Чат не нашёл." });
        }
        try {
          const draft = await this.conversations.getPendingMedia(user.telegramUserId);
          const result = await this.send.requestOrSend({
            actorTelegramId: user.telegramUserId,
            text,
            chats: [chat],
            summary: chat.title,
            media: draft?.media ?? [],
          });
          return this.decorate(user, { text: result.message });
        } catch (error) {
          return this.withConfirmIfNeeded(user, error instanceof Error ? error.message : "Не отправил.");
        }
      }
      if (pending.kind === "broadcast_group") {
        const chats = await this.chats.findByFilter({ groupId: pending.groupId });
        if (chats.length === 0) {
          return this.decorate(user, { text: "К этой группе чат ещё не привязан. Разметь его и повтори." });
        }
        try {
          const draft = await this.conversations.getPendingMedia(user.telegramUserId);
          const result = await this.send.requestOrSend({
            actorTelegramId: user.telegramUserId,
            text,
            chats,
            summary: chats[0]?.title ?? "чат группы",
            media: draft?.media ?? [],
          });
          return this.decorate(user, { text: result.message });
        } catch (error) {
          return this.withConfirmIfNeeded(user, error instanceof Error ? error.message : "Не отправил.");
        }
      }
      if (pending.kind === "broadcast_branch") {
        const chats = await this.chats.findByFilter({ branchId: pending.branchId });
        if (chats.length === 0) {
          return this.decorate(user, { text: "У филиала нет размеченных чатов." });
        }
        try {
          const draft = await this.conversations.getPendingMedia(user.telegramUserId);
          const result = await this.send.requestOrSend({
            actorTelegramId: user.telegramUserId,
            text,
            chats,
            summary: "чаты филиала",
            media: draft?.media ?? [],
          });
          return this.decorate(user, { text: result.message });
        } catch (error) {
          return this.withConfirmIfNeeded(user, error instanceof Error ? error.message : "Не отправил.");
        }
      }
      if (pending.kind === "event_add") {
        const parsed = parseEventDraft(text);
        if (!parsed) {
          await this.conversations.setPendingUi(user.telegramUserId, pending);
          return this.decorate(user, {
            text: "Начни с слова **аттестация**, **соревнование** или **лагерь**, потом дата и зал.",
          });
        }
        const created: {
          kind: SchoolEventKind;
          title: string;
          dateNote: string;
          place?: string;
          note?: string;
          actorTelegramId: string;
        } = {
          kind: parsed.kind,
          title: parsed.title,
          dateNote: parsed.dateNote,
          actorTelegramId: user.telegramUserId,
        };
        if (parsed.place) {
          created.place = parsed.place;
        }
        if (parsed.note) {
          created.note = parsed.note;
        }
        await this.schoolEvents.upsert(created);
        return this.eventsScreen(user);
      }
      if (pending.kind === "kb_field") {
        if (pending.fieldIndex === null) {
          const parsed = parseFieldLine(text);
          if (!parsed) {
            await this.conversations.setPendingUi(user.telegramUserId, pending);
            return this.decorate(user, { text: "Так: **дан: I дан**. Ключ, двоеточие, значение." });
          }
          await this.knowledge.setField({
            id: pending.docId,
            key: parsed.key,
            value: parsed.value,
            actorTelegramId: user.telegramUserId,
          });
        } else {
          await this.knowledge.setField({
            id: pending.docId,
            key: (await this.fieldKeyAt(pending.docId, pending.fieldIndex)) ?? "поле",
            value: text.trim(),
            actorTelegramId: user.telegramUserId,
          });
        }
        return this.knowledgeCard(user, pending.docId);
      }
      if (pending.kind === "edit_schedule") {
        const weekdays = this.schedule.parseWeekdays(text);
        const time = text.match(/(\d{1,2}[:.]\d{2})/)?.[1]?.replace(".", ":") ?? null;
        if (weekdays.length > 0) {
          const dayRu: Record<string, string> = {
            mon: "пн",
            tue: "вт",
            wed: "ср",
            thu: "чт",
            fri: "пт",
            sat: "сб",
            sun: "вс",
          };
          await this.knowledge.setField({
            id: pending.groupId,
            key: "дни",
            value: weekdays.map((day) => dayRu[day] ?? day).join(", "),
            actorTelegramId: user.telegramUserId,
          });
        }
        if (time) {
          await this.knowledge.setField({
            id: pending.groupId,
            key: "время",
            value: time,
            actorTelegramId: user.telegramUserId,
          });
        }
        return this.scheduleGroupCard(user, pending.groupId);
      }
    } catch (error) {
      return this.decorate(user, {
        text: error instanceof Error ? error.message : "Не получилось.",
      });
    }
    return null;
  }

  async withConfirmIfNeeded(user: StaffUser, text: string): Promise<BotReply> {
    const reply: BotReply = { text };
    const pending = (await this.conversations.load(user.telegramUserId)).pendingSend;
    if (pending) {
      reply.inline = confirmSendKeyboard(pending.confirmationId);
    }
    return this.decorate(user, reply);
  }

  private async findBranchCard(key: string): Promise<KnowledgeDoc | null> {
    const cards = await this.knowledge.listBranchCards();
    return cards.find((item) => item._id === key || item.branchId === key) ?? null;
  }

  private async fieldKeyAt(docId: string, index: number): Promise<string | undefined> {
    const doc = await this.knowledge.getActive(docId);
    return doc ? docFields(doc.fields)[index]?.key : undefined;
  }

  private denyIfNeeded(user: StaffUser, required: StaffRole): BotReply | null {
    if (hasAtLeast(user.role, required)) {
      return null;
    }
    return this.decorate(user, { text: "Это уже не твоя зона. Нужна роль повыше." });
  }

  private async staffText(user: StaffUser): Promise<string> {
    const people = await this.staff.listStaff(user);
    const lines = people.map((person) => {
      const name = person.isOwner ? MASTER_KOLOTUSHIN : person.displayName ?? person.username ?? person.telegramUserId;
      const nick = person.username ? ` @${person.username}` : "";
      return `• **${name}**${nick} — ${roleLabel(person.role)}`;
    });
    return `**Штат**\n\n${lines.join("\n")}`;
  }

  private async notesList(user: StaffUser, page = 0): Promise<BotReply> {
    const notes = await this.notes.list(user, { status: "active", limit: 100 });
    if (notes.length === 0) {
      return this.decorate(user, {
        text: "Пока нет заметок. Попроси Грифон идеи по росту клуба — он сохранит их сюда через save_note.",
      });
    }
    const slice = notes.slice(page * PAGE, page * PAGE + PAGE);
    const items = slice.map((note) => ({
      text: note.title,
      data: `notes:i:${note._id}`,
    }));
    const nav: Array<{ text: string; data: string }> = [];
    if (page > 0) {
      nav.push({ text: "←", data: `notes:p:${page - 1}` });
    }
    if ((page + 1) * PAGE < notes.length) {
      nav.push({ text: "→", data: `notes:p:${page + 1}` });
    }
    return this.decorate(user, {
      text: `**Заметки суперадмина** (${notes.length})\nТолько для тебя — не База Знаний.`,
      inline: pageButtons(items, nav),
    });
  }

  private async notesRoute(user: StaffUser, data: string): Promise<BotReply> {
    if (data === "notes") {
      return this.notesList(user);
    }
    const pageMatch = /^notes:p:(\d+)$/.exec(data);
    if (pageMatch?.[1]) {
      return this.notesList(user, Number(pageMatch[1]));
    }
    const idMatch = /^notes:i:(.+)$/.exec(data);
    if (idMatch?.[1]) {
      const note = await this.notes.get(user, idMatch[1]);
      const tags = note.tags.length > 0 ? `\nТеги: ${note.tags.join(", ")}` : "";
      return this.decorate(user, {
        text: `**${note.title}**${tags}\n\n${note.body}`,
        inline: pageButtons([{ text: "← К списку", data: "notes" }]),
      });
    }
    return this.notesList(user);
  }
}

function hiddenNamespaces(_user: StaffUser): Array<"internal"> {
  // internal (Мастер / личные профили) есть в RAG для агента, но не в кнопках Базы знаний
  return ["internal"];
}

function parseKnowledgeCategory(raw: string): KnowledgeUiCategory | null {
  if (
    raw === "people" ||
    raw === "branch" ||
    raw === "faq" ||
    raw === "topic" ||
    raw === "schedule" ||
    raw === "other"
  ) {
    return raw;
  }
  return null;
}

function minRoleForCallback(data: string): StaffRole {
  if (data.startsWith("staff:") || data === "notes" || data.startsWith("notes:")) {
    return "superadmin";
  }
  if (data.startsWith("e:c:")) {
    return "admin";
  }
  if (
    data === "org:sync" ||
    data === "f:sync" ||
    data.startsWith("s:e:") ||
    data.startsWith("k:d:") ||
    data.startsWith("k:p:") ||
    data.startsWith("k:e:") ||
    data.startsWith("k:u:") ||
    data.startsWith("k:f:") ||
    data.startsWith("v:") ||
    data === "kb:add" ||
    data === "k:a"
  ) {
    return "admin";
  }
  return "operator";
}

function minRoleForPending(kind: string): StaffRole {
  if (kind === "assign_role" || kind === "revoke_role") {
    return "superadmin";
  }
  if (kind === "edit_schedule" || kind === "escalate_answer" || kind === "kb_field" || kind === "event_add") {
    return "admin";
  }
  return "operator";
}

function mediaBufferIntro(count: number, caption: string | null): string {
  const lines = [
    `Принял **${count}** вложени${count === 1 ? "е" : count < 5 ? "я" : "й"} в буфер рассылки.`,
    "Выбери чаты кнопками ниже — или напиши/скажи куда (KolTech, «всем родителям»…).",
  ];
  if (caption && caption.trim().length > 0) {
    lines.push(`Подпись: ${caption.trim()}`);
  } else {
    lines.push("Подписи нет — уйдёт только медиа (текст можно дописать голосом/текстом при отправке через агента).");
  }
  return lines.join("\n");
}

function roleLabel(role: StaffRole | null): string {
  if (role === "superadmin") {
    return "суперадмин";
  }
  if (role === "admin") {
    return "админ";
  }
  if (role === "operator") {
    return "оператор";
  }
  return "без роли";
}

function fieldOf(doc: KnowledgeDoc, key: string): string | undefined {
  return docFields(doc.fields).find((field) => field.key === key)?.value;
}

function scheduleBelongsToBranch(group: KnowledgeDoc, branch: KnowledgeDoc | null): boolean {
  if (!branch) {
    return false;
  }
  if (group.branchId && (group.branchId === branch.branchId || group.branchId === branch._id)) {
    return true;
  }
  const filial = fieldOf(group, "филиал");
  return Boolean(filial && filial === branch.title);
}

function parseEventDraft(text: string): {
  kind: SchoolEventKind;
  title: string;
  dateNote: string;
  place?: string;
  note?: string;
} | null {
  const trimmed = text.trim();
  const kindMatch = trimmed.match(/^(аттестац\w*|соревнован\w*|старт\w*|лагер\w*|смен\w*)\s+(.+)$/i);
  if (!kindMatch?.[1] || !kindMatch[2]) {
    return null;
  }
  const head = kindMatch[1].toLowerCase();
  const rest = kindMatch[2].trim();
  let kind: SchoolEventKind = "attestation";
  if (/соревнован|старт/.test(head)) {
    kind = "competition";
  } else if (/лагер|смен/.test(head)) {
    kind = "camp";
  }
  const parts = rest.split(",").map((part) => part.trim()).filter(Boolean);
  const dateNote = parts[0] ?? rest;
  const place = parts[1];
  const note = parts.slice(2).join(", ") || undefined;
  const title = place ? `${dateNote} · ${place}` : dateNote;
  const result: {
    kind: SchoolEventKind;
    title: string;
    dateNote: string;
    place?: string;
    note?: string;
  } = { kind, title, dateNote };
  if (place) {
    result.place = place;
  }
  if (note) {
    result.note = note;
  }
  return result;
}

function parseStaffTarget(text: string): { telegramUserId?: string; username?: string } {
  const trimmed = text.trim();
  if (/^\d{5,}$/.test(trimmed)) {
    return { telegramUserId: trimmed };
  }
  return { username: trimmed.replace(/^@/, "") };
}
