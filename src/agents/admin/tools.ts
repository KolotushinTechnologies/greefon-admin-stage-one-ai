import { ConfirmationRequiredError, DomainError } from "../../platform/shared/errors.js";
import { hasAtLeast, type StaffUser } from "../../platform/identity/types.js";
import type { StaffService } from "../../platform/identity/staff.service.js";
import type { ChatRepository } from "../../platform/org/chat.repository.js";
import type { OrgRepository } from "../../platform/org/org.repository.js";
import type { ScheduleService } from "../../platform/org/schedule.service.js";
import type { TargetResolver } from "../../platform/org/target-resolver.js";
import type { KnowledgeService } from "../../platform/knowledge/knowledge.service.js";
import type { KnowledgeGroundingService } from "../../platform/knowledge/knowledge-grounding.service.js";
import type { SendService } from "../../platform/messaging/send.service.js";
import type { ConversationStore } from "../../platform/conversation/conversation.store.js";
import type { RegisteredTool, ToolExecutionContext } from "../../platform/agent-runtime/types.js";
import type { ChatAudience, ChatCategory, Weekday } from "../../platform/org/types.js";
import type { KnowledgeKind, KnowledgeNamespace } from "../../platform/knowledge/types.js";
import { collectTopics } from "./topics.js";
import type { SchoolEventService } from "../../platform/events/event.service.js";
import type { SchoolEventKind } from "../../platform/events/types.js";
import type { NotesService } from "../../platform/notes/notes.service.js";

type Deps = {
  staff: StaffService;
  org: OrgRepository;
  chats: ChatRepository;
  resolver: TargetResolver;
  schedule: ScheduleService;
  knowledge: KnowledgeService;
  knowledgeGrounding: KnowledgeGroundingService;
  send: SendService;
  conversations: ConversationStore;
  schoolEvents: SchoolEventService;
  notes: NotesService;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asBool(value: unknown): boolean {
  return value === true || value === "true";
}

function loadStaff(ctx: ToolExecutionContext, staff: StaffService): Promise<StaffUser | null> {
  return staff.resolveStaff(ctx.telegramUserId, ctx.username, ctx.displayName);
}

export function buildAdminTools(deps: Deps): RegisteredTool[] {
  return [
    {
      name: "resolve_targets",
      description: "Подобрать целевые чаты. raw — куда слать (чат/филиал), не текст объявления. Не отправляет сообщения.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          raw: { type: "string", description: "Куда: KolTech, дыбенко, малыши — без текста объявления" },
          branch_hint: { type: "string" },
          group_hint: { type: "string" },
          audience: { type: "string", enum: ["parents", "coaches", "staff", "mixed", "all"] },
          all_branches: { type: "boolean" },
          all_chats: { type: "boolean" },
          include_closed: { type: "boolean" },
        },
      },
      handler: async (input) => {
        try {
          const resolved = await deps.resolver.resolve({
            raw: asString(input.raw),
            branchHint: asString(input.branch_hint),
            groupHint: asString(input.group_hint),
            audience: asString(input.audience) as ChatAudience | "all" | undefined,
            allBranches: asBool(input.all_branches),
            allChats: asBool(input.all_chats),
            includeClosed: asBool(input.include_closed),
          });
          return {
            count: resolved.chats.length,
            summary: resolved.summary,
            needs_confirmation: resolved.needsConfirmation,
            chats: resolved.chats.map((chat) => ({
              id: chat.telegramChatId,
              title: chat.title,
              audience: chat.audience,
              branchId: chat.branchId,
              groupId: chat.groupId,
            })),
            branch: resolved.branch ? { id: resolved.branch._id, name: resolved.branch.name } : null,
            group: resolved.group ? { id: resolved.group._id, name: resolved.group.name } : null,
          };
        } catch (error) {
          return stringifyError(error);
        }
      },
    },
    {
      name: "draft_message",
      description: "Собрать черновик объявления. Сам текст можно сразу отдать админу, этот инструмент нужен чтобы зафиксировать адресатов.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: { type: "string" },
          raw: { type: "string" },
          branch_hint: { type: "string" },
          group_hint: { type: "string" },
          audience: { type: "string", enum: ["parents", "coaches", "staff", "mixed", "all"] },
        },
      },
      handler: async (input) => {
        const text = asString(input.text);
        if (!text) {
          return { error: "Пустой текст." };
        }
        try {
          const resolved = await deps.resolver.resolve({
            raw: asString(input.raw),
            branchHint: asString(input.branch_hint),
            groupHint: asString(input.group_hint),
            audience: asString(input.audience) as ChatAudience | "all" | undefined,
          });
          return { draft: text, summary: resolved.summary, chat_count: resolved.chats.length, needs_confirmation: resolved.needsConfirmation };
        } catch (error) {
          return { draft: text, unresolved: stringifyError(error) };
        }
      },
    },
    {
      name: "send_message",
      description:
        "Отправить текст и/или вложения в чаты. raw — только куда слать (название чата/филиала), не весь текст объявления. text — что отправить. Если чатов больше одного — сначала спросит подтверждение.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          raw: { type: "string", description: "Куда: KolTech, колтех, дыбенко родители — без текста объявления" },
          branch_hint: { type: "string" },
          group_hint: { type: "string" },
          audience: { type: "string", enum: ["parents", "coaches", "staff", "mixed", "all"] },
          all_branches: { type: "boolean" },
          all_chats: { type: "boolean" },
        },
      },
      handler: async (input, ctx) => {
        const text = asString(input.text) ?? "";
        try {
          const draft = await deps.conversations.getPendingMedia(ctx.telegramUserId);
          const media = draft?.media ?? [];
          const body = text.trim().length > 0 ? text : (draft?.caption ?? "");
          if (body.trim().length === 0 && media.length === 0) {
            return { error: "Нужен текст или вложения (фото/видео)." };
          }
          const resolved = await deps.resolver.resolve({
            raw: asString(input.raw),
            branchHint: asString(input.branch_hint),
            groupHint: asString(input.group_hint),
            audience: asString(input.audience) as ChatAudience | "all" | undefined,
            allBranches: asBool(input.all_branches),
            allChats: asBool(input.all_chats),
          });
          const result = await deps.send.requestOrSend({
            actorTelegramId: ctx.telegramUserId,
            text: body,
            chats: resolved.chats,
            summary: resolved.summary,
            media,
          });
          if (media.length > 0) {
            await deps.conversations.takePendingMedia(ctx.telegramUserId);
          }
          return {
            ...result,
            hint: "В отчёте только mediaSummary из результата. Для второго чата с тем же пакетом — resend_broadcast, не жди старый буфер.",
          };
        } catch (error) {
          if (error instanceof ConfirmationRequiredError) {
            // Медиа уже в pendingSend; буфер чистим, чтобы не склеить со следующим фото.
            if (((await deps.conversations.getPendingMedia(ctx.telegramUserId))?.media.length ?? 0) > 0) {
              await deps.conversations.takePendingMedia(ctx.telegramUserId);
            }
            return {
              needs_confirmation: true,
              confirmation_id: error.confirmationId,
              message: error.message,
              hint: "Не подтверждай сам. Админ нажмёт кнопку или напишет «да» следующим сообщением.",
            };
          }
          return stringifyError(error);
        }
      },
    },
    {
      name: "list_recent_broadcasts",
      description:
        "Последние рассылки этого админа (текст + сколько реально было вложений). Для «то же / как второе / повтори».",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      handler: async (input, ctx) => {
        const limit = typeof input.limit === "number" ? input.limit : 8;
        const items = await deps.send.listRecent(ctx.telegramUserId, limit);
        if (items.length === 0) {
          return { items: [], hint: "Пока нет сохранённых рассылок. Новые появятся после send_message." };
        }
        return {
          items,
          hint: "Покажи админу нумерованный список. Повтор — resend_broadcast с index или id.",
        };
      },
    },
    {
      name: "resend_broadcast",
      description:
        "Повторить сохранённую рассылку целиком (текст + те же file_id вложений) в новые чаты. raw — куда слать. Не копируй текст из истории чата.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "number", description: "Номер из list_recent_broadcasts (1 = самая свежая)" },
          outbound_id: { type: "string" },
          raw: { type: "string", description: "Куда: 20к1, KolTech, дыбенко — без текста объявления" },
          branch_hint: { type: "string" },
          group_hint: { type: "string" },
          audience: { type: "string", enum: ["parents", "coaches", "staff", "mixed", "all"] },
          all_branches: { type: "boolean" },
          all_chats: { type: "boolean" },
        },
      },
      handler: async (input, ctx) => {
        try {
          const index = typeof input.index === "number" ? input.index : undefined;
          const outboundId = asString(input.outbound_id);
          if (index === undefined && !outboundId) {
            return { error: "Нужен index из list_recent_broadcasts или outbound_id." };
          }
          const resolved = await deps.resolver.resolve({
            raw: asString(input.raw),
            branchHint: asString(input.branch_hint),
            groupHint: asString(input.group_hint),
            audience: asString(input.audience) as ChatAudience | "all" | undefined,
            allBranches: asBool(input.all_branches),
            allChats: asBool(input.all_chats),
          });
          const result = await deps.send.resend({
            actorTelegramId: ctx.telegramUserId,
            ...(outboundId ? { outboundId } : {}),
            ...(index !== undefined ? { index } : {}),
            chats: resolved.chats,
            summary: resolved.summary,
          });
          return {
            ...result,
            hint: "Пиши админу mediaSummary как есть. Не добавляй «N фото», если mediaCount=0.",
          };
        } catch (error) {
          if (error instanceof ConfirmationRequiredError) {
            return {
              needs_confirmation: true,
              confirmation_id: error.confirmationId,
              message: error.message,
              hint: "Не подтверждай сам. Жди кнопку или «да».",
            };
          }
          return stringifyError(error);
        }
      },
    },
    {
      name: "list_chats",
      description: "Показать известные чаты и как они размечены.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          unlabeled_only: { type: "boolean" },
        },
      },
      handler: async (input) => {
        const chats = await deps.chats.listAll();
        const filtered = asBool(input.unlabeled_only)
          ? chats.filter((chat) => !chat.branchId || chat.audience === "unknown")
          : chats;
        return filtered.map((chat) => ({
          id: chat.telegramChatId,
          title: chat.title,
          audience: chat.audience,
          category: chat.category,
          branchId: chat.branchId,
          groupId: chat.groupId,
          labels: chat.labels,
        }));
      },
    },
    {
      name: "label_chat",
      description: "Привязать чат к филиалу, группе и аудитории.",
      minRole: "admin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["chat_query"],
        properties: {
          chat_query: { type: "string", description: "Название чата или его telegram id" },
          branch_hint: { type: "string" },
          group_hint: { type: "string" },
          audience: { type: "string", enum: ["parents", "coaches", "staff", "mixed", "unknown"] },
          category: { type: "string", enum: ["branch", "group", "coaches", "staff", "announcements", "other"] },
          labels: { type: "array", items: { type: "string" } },
        },
      },
      handler: async (input, ctx) => {
        const query = asString(input.chat_query) ?? "";
        const chats = await deps.chats.listAll();
        const chat =
          chats.find((item) => item.telegramChatId === query) ??
          chats.find((item) => item.title.toLowerCase().includes(query.toLowerCase()));
        if (!chat) {
          return { error: "Такой чат не вижу. Сначала добавь бота в группу." };
        }
        let branchId: string | null = chat.branchId;
        let groupId: string | null = chat.groupId;
        if (asString(input.branch_hint) || asString(input.group_hint)) {
          try {
            const resolved = await deps.resolver.resolve({
              branchHint: asString(input.branch_hint),
              groupHint: asString(input.group_hint),
              raw: `${asString(input.branch_hint) ?? ""} ${asString(input.group_hint) ?? ""}`,
            });
            branchId = resolved.branch?._id ?? branchId;
            groupId = resolved.group?._id ?? groupId;
          } catch (error) {
            return stringifyError(error);
          }
        }
        const updated = await deps.chats.label(chat.telegramChatId, {
          branchId,
          groupId,
          audience: (asString(input.audience) as ChatAudience | undefined) ?? chat.audience,
          category: (asString(input.category) as ChatCategory | undefined) ?? chat.category,
          labels: Array.isArray(input.labels) ? input.labels.map(String) : chat.labels,
          labeledByTelegramId: ctx.telegramUserId,
        });
        return updated;
      },
    },
    {
      name: "list_org",
      description:
        "Справочник филиалов, групп и тренеров из Базы Знаний. Для полного состава тренеров смотри instructors_roster — перечисляй всех оттуда, никого не выкидывай.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          include_closed: { type: "boolean" },
          branch_hint: { type: "string" },
        },
      },
      handler: async (input) => {
        const hint = asString(input.branch_hint)?.toLowerCase();
        const branches = (await deps.knowledge.listBranchCards()).filter((item) =>
          hint ? item.title.toLowerCase().includes(hint) : true,
        );
        const groups = await deps.knowledge.listScheduleCards();
        const instructors = await deps.knowledge.listStaffProfiles();
        return {
          branches: branches.map((item) => ({ id: item._id, name: item.title, fields: item.fields ?? [] })),
          groups: groups
            .filter((item) => (hint ? item.title.toLowerCase().includes(hint) : true))
            .map((item) => ({ id: item._id, title: item.title, fields: item.fields ?? [] })),
          instructors_roster: deps.knowledge.formatInstructorsRoster(instructors),
          instructors: instructors.map((item) => ({
            id: item._id,
            name: item.title,
            fields: item.fields ?? [],
            body: item.body,
          })),
        };
      },
    },
    {
      name: "list_instructors",
      description:
        "Полный состав тренеров из Базы Знаний. instructors_roster / parent_message — готовый текст: для «кто тренеры / состав» отдай его как есть, никого не пропускай.",
      minRole: "operator",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      handler: async () => {
        const people = await deps.knowledge.listStaffProfiles();
        const roster = deps.knowledge.formatInstructorsRoster(people);
        return {
          count: people.length,
          parent_message: roster,
          instructors_roster: roster,
          people: people.map((item) => ({
            id: item._id,
            name: item.title,
            fields: item.fields ?? [],
            body: item.body,
          })),
        };
      },
    },
    {
      name: "get_schedule",
      description: "Показать актуальное расписание филиала или группы.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          raw: { type: "string" },
          branch_hint: { type: "string" },
          group_hint: { type: "string" },
          include_closed: { type: "boolean" },
        },
      },
      handler: async (input) => ({
        text: await deps.schedule.describe({
          raw: asString(input.raw),
          branchHint: asString(input.branch_hint),
          groupHint: asString(input.group_hint),
          includeClosed: asBool(input.include_closed),
        }),
      }),
    },
    {
      name: "upsert_schedule",
      description: "Поправить расписание группы в Базе Знаний.",
      minRole: "admin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          raw: { type: "string" },
          branch_hint: { type: "string" },
          group_hint: { type: "string" },
          weekdays_text: { type: "string", description: "например: вторник и четверг" },
          time_note: { type: "string" },
          note: { type: "string" },
        },
      },
      handler: async (input, ctx) => {
        const weekdays = asString(input.weekdays_text) ? deps.schedule.parseWeekdays(String(input.weekdays_text)) : undefined;
        const patch: {
          raw?: string;
          branchHint?: string;
          groupHint?: string;
          weekdays?: Weekday[];
          timeNote?: string;
          note?: string;
          actorTelegramId: string;
        } = { actorTelegramId: ctx.telegramUserId };
        const raw = asString(input.raw);
        const branchHint = asString(input.branch_hint);
        const groupHint = asString(input.group_hint);
        const timeNote = asString(input.time_note);
        const note = asString(input.note);
        if (raw) {
          patch.raw = raw;
        }
        if (branchHint) {
          patch.branchHint = branchHint;
        }
        if (groupHint) {
          patch.groupHint = groupHint;
        }
        if (weekdays && weekdays.length > 0) {
          patch.weekdays = weekdays as Weekday[];
        }
        if (timeNote) {
          patch.timeNote = timeNote;
        }
        if (note) {
          patch.note = note;
        }
        return { message: await deps.schedule.override(patch) };
      },
    },
    {
      name: "ground_mentions",
      description:
        "Умное наведение по Базе Знаний и чатам: если имя/зал/чат звучит криво (голос, опечатка) — вернёт лучшие совпадения по слоям person/branch/schedule/chat/topic. Вызывай при сомнении в фамилии или названии, затем переспроси админа готовым вариантом.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: { type: "string", description: "Фрагмент или вся фраза админа" },
        },
      },
      handler: async (input) => {
        const text = asString(input.text);
        if (!text) {
          return { error: "Пустой текст." };
        }
        const hits = await deps.knowledgeGrounding.suggest(text);
        return {
          hits: hits.map((hit) => ({
            span: hit.span,
            lane: hit.lane,
            title: hit.title,
            id: hit.id,
            score: hit.score,
            hint: hit.hint,
            ask: hit.ask,
          })),
          guidance:
            hits.length === 0
              ? "Явных совпадений нет — уточни у админа или search_knowledge."
              : "Переспроси одним сообщением с лучшим вариантом (ask). Не подставляй фамилию втихую, если score < 0.9.",
        };
      },
    },
    {
      name: "search_knowledge",
      description:
        "Искать в Базе Знаний. Звание, дан, пояс — только отсюда. Нет в выдаче — не пиши. Для кривых имён с голоса сначала ground_mentions.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string" },
          kind: { type: "string", enum: ["policy", "branch", "group", "schedule", "topic", "chat_note", "faq"] },
        },
      },
      handler: async (input, ctx) => {
        const query = asString(input.query);
        if (!query) {
          return { error: "Пустой запрос." };
        }
        return deps.knowledge.lookup({
          query,
          kind: asString(input.kind) as KnowledgeKind | undefined,
          excludeNamespaces: ctx.role === "superadmin" ? [] : ["internal"],
        });
      },
    },
    {
      name: "suggest_topics",
      description: "Подобрать темы для разговора с родителями из базы знаний.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "например: малыши 4-5, первая тренировка" },
        },
      },
      handler: async (input) => ({
        text: await collectTopics(deps.knowledge, asString(input.query) ?? "темы для общения с родителями"),
      }),
    },
    {
      name: "upsert_knowledge",
      description:
        "Добавить или обновить запись в базе знаний. kind: branch=филиал, faq=FAQ/человек (у человека поле роль: тренер), topic=тема для родителей (НЕ ФИО), schedule=группа, policy=политика. Не клади тренеров в topic. namespace=internal — скрыто из кнопок Базы (только агент; для Мастера Колотушина).",
      minRole: "admin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body", "kind"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          kind: {
            type: "string",
            enum: ["policy", "branch", "group", "schedule", "topic", "chat_note", "faq"],
            description: "topic только для скриптов родителям; людей/тренеров — faq + роль",
          },
          namespace: { type: "string", enum: ["admin", "parents", "coaches", "sales", "internal"] },
          branch_hint: { type: "string" },
          group_hint: { type: "string" },
        },
      },
      handler: async (input, ctx) => {
        let branchId: string | null = null;
        let groupId: string | null = null;
        if (asString(input.branch_hint) || asString(input.group_hint)) {
          try {
            const resolved = await deps.resolver.resolve({
              branchHint: asString(input.branch_hint),
              groupHint: asString(input.group_hint),
            });
            branchId = resolved.branch?._id ?? null;
            groupId = resolved.group?._id ?? null;
          } catch {
            branchId = null;
          }
        }
        const upsertInput: {
          id?: string;
          title: string;
          body: string;
          kind: KnowledgeKind;
          namespace: KnowledgeNamespace;
          branchId: string | null;
          groupId: string | null;
          actorTelegramId: string;
        } = {
          title: asString(input.title) ?? "Без названия",
          body: asString(input.body) ?? "",
          kind: (asString(input.kind) as KnowledgeKind | undefined) ?? "policy",
          namespace: (asString(input.namespace) as KnowledgeNamespace | undefined) ?? "admin",
          branchId,
          groupId,
          actorTelegramId: ctx.telegramUserId,
        };
        const existingId = asString(input.id);
        if (existingId) {
          upsertInput.id = existingId;
        }
        const doc = await deps.knowledge.upsert(upsertInput);
        return { id: doc._id, title: doc.title, kind: doc.kind, namespace: doc.namespace };
      },
    },
    {
      name: "delete_knowledge",
      description: "Удалить запись из базы знаний.",
      minRole: "admin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      handler: async (input, ctx) => {
        const id = asString(input.id);
        if (!id) {
          return { error: "Нужен id." };
        }
        await deps.knowledge.remove(id, ctx.telegramUserId);
        return { deleted: true, id };
      },
    },
    {
      name: "edit_knowledge_field",
      description:
        "Поставить или убрать одно поле карточки базы знаний. Для «добавь Маитову дан I», «убери у Карины поле дан». Не переписывай всю карточку ради одного факта.",
      minRole: "admin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["action", "field"],
        properties: {
          action: { type: "string", enum: ["set", "delete"] },
          id: { type: "string" },
          title: { type: "string" },
          field: { type: "string" },
          value: { type: "string" },
        },
      },
      handler: async (input, ctx) => {
        const action = asString(input.action);
        const field = asString(input.field);
        if (!field) {
          return { error: "Нужно имя поля." };
        }
        const target: { id?: string; title?: string; actorTelegramId: string } = {
          actorTelegramId: ctx.telegramUserId,
        };
        const id = asString(input.id);
        const title = asString(input.title);
        if (id) {
          target.id = id;
        }
        if (title) {
          target.title = title;
        }
        if (action === "delete") {
          const doc = await deps.knowledge.removeField({ ...target, key: field });
          return { id: doc._id, title: doc.title, fields: doc.fields ?? [] };
        }
        const value = asString(input.value);
        if (!value) {
          return { error: "Нужно значение поля." };
        }
        const doc = await deps.knowledge.setField({ ...target, key: field, value });
        return { id: doc._id, title: doc.title, fields: doc.fields ?? [] };
      },
    },
    {
      name: "list_events",
      description: "Список аттестаций, стартов и смен лагеря.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["attestation", "competition", "camp"] },
          include_closed: { type: "boolean" },
        },
      },
      handler: async (input) => {
        const kind = asString(input.kind) as SchoolEventKind | undefined;
        const upcoming = await deps.schoolEvents.listUpcoming(kind);
        return upcoming.map((item) => ({
          id: item._id,
          kind: item.kind,
          text: deps.schoolEvents.format(item),
        }));
      },
    },
    {
      name: "upsert_event",
      description: "Создать или обновить аттестацию, соревнование или смену лагеря.",
      minRole: "admin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "title", "date_note"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["attestation", "competition", "camp"] },
          title: { type: "string" },
          date_note: { type: "string" },
          place: { type: "string" },
          note: { type: "string" },
        },
      },
      handler: async (input, ctx) => {
        const kind = asString(input.kind) as SchoolEventKind | undefined;
        const title = asString(input.title);
        const dateNote = asString(input.date_note);
        if (!kind || !title || !dateNote) {
          return { error: "Нужны тип, название и дата." };
        }
        const payload: {
          id?: string;
          kind: SchoolEventKind;
          title: string;
          dateNote: string;
          place?: string;
          note?: string;
          actorTelegramId: string;
        } = {
          kind,
          title,
          dateNote,
          actorTelegramId: ctx.telegramUserId,
        };
        const id = asString(input.id);
        if (id) {
          payload.id = id;
        }
        const place = asString(input.place);
        if (place) {
          payload.place = place;
        }
        const note = asString(input.note);
        if (note) {
          payload.note = note;
        }
        const doc = await deps.schoolEvents.upsert(payload);
        return { id: doc._id, text: deps.schoolEvents.format(doc) };
      },
    },
    {
      name: "close_event",
      description: "Закрыть событие — родители больше не увидят дату.",
      minRole: "admin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      handler: async (input, ctx) => {
        const id = asString(input.id);
        if (!id) {
          return { error: "Нужен id." };
        }
        const doc = await deps.schoolEvents.close(id, ctx.telegramUserId);
        return { id: doc._id, status: doc.status };
      },
    },
    {
      name: "manage_staff",
      description: "Назначить или снять роль. Только суперадмин.",
      minRole: "superadmin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["list", "assign", "revoke"] },
          username: { type: "string" },
          telegram_user_id: { type: "string" },
          role: { type: "string", enum: ["superadmin", "admin", "operator"] },
        },
      },
      handler: async (input, ctx) => {
        const actor = await loadStaff(ctx, deps.staff);
        if (!actor) {
          return { error: "Нет доступа." };
        }
        const action = asString(input.action);
        if (action === "list") {
          const people = await deps.staff.listStaff(actor);
          return people.map((person) => ({
            telegramUserId: person.telegramUserId,
            username: person.username,
            role: person.role,
            status: person.status,
          }));
        }
        if (action === "assign") {
          const role = asString(input.role) as StaffUser["role"];
          if (!role) {
            return { error: "Нужна роль." };
          }
          const assignTarget: { telegramUserId?: string; username?: string } = {};
          const telegramUserId = asString(input.telegram_user_id);
          const username = asString(input.username);
          if (telegramUserId) {
            assignTarget.telegramUserId = telegramUserId;
          }
          if (username) {
            assignTarget.username = username;
          }
          const updated = await deps.staff.assignRole(actor, assignTarget, role);
          return { telegramUserId: updated.telegramUserId, role: updated.role };
        }
        if (action === "revoke") {
          const revokeTarget: { telegramUserId?: string; username?: string } = {};
          const revokeId = asString(input.telegram_user_id);
          const revokeUsername = asString(input.username);
          if (revokeId) {
            revokeTarget.telegramUserId = revokeId;
          }
          if (revokeUsername) {
            revokeTarget.username = revokeUsername;
          }
          await deps.staff.revoke(actor, revokeTarget);
          return { revoked: true };
        }
        return { error: "Неизвестное действие." };
      },
    },
    {
      name: "save_note",
      description:
        "Сохранить идею/заметку суперадмина (рост клуба, маркетинг, тренеры). Не попадает в Базу Знаний. Только суперадмин.",
      minRole: "superadmin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body"],
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
      handler: async (input, ctx) => {
        try {
          const actor = await loadStaff(ctx, deps.staff);
          if (!actor) {
            return { error: "Нет доступа." };
          }
          const title = asString(input.title);
          const body = asString(input.body);
          if (!title || !body) {
            return { error: "Нужны title и body." };
          }
          const tags = Array.isArray(input.tags)
            ? input.tags.filter((item): item is string => typeof item === "string")
            : undefined;
          const note = await deps.notes.create(actor, {
            title,
            body,
            ...(tags ? { tags } : {}),
          });
          return { id: note._id, title: note.title, tags: note.tags, saved: true };
        } catch (error) {
          return stringifyError(error);
        }
      },
    },
    {
      name: "list_notes",
      description: "Список личных заметок суперадмина (идеи роста клуба). Только суперадмин.",
      minRole: "superadmin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["active", "archived"] },
          limit: { type: "number" },
        },
      },
      handler: async (input, ctx) => {
        try {
          const actor = await loadStaff(ctx, deps.staff);
          if (!actor) {
            return { error: "Нет доступа." };
          }
          const status = asString(input.status) as "active" | "archived" | undefined;
          const limit = typeof input.limit === "number" ? input.limit : undefined;
          const notes = await deps.notes.list(actor, {
            status: status ?? "active",
            limit: limit ?? 30,
          });
          return notes.map((note) => ({
            id: note._id,
            title: note.title,
            tags: note.tags,
            updatedAt: note.updatedAt,
            preview: note.body.slice(0, 160),
          }));
        } catch (error) {
          return stringifyError(error);
        }
      },
    },
    {
      name: "get_note",
      description: "Открыть заметку суперадмина целиком. Только суперадмин.",
      minRole: "superadmin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
      handler: async (input, ctx) => {
        try {
          const actor = await loadStaff(ctx, deps.staff);
          if (!actor) {
            return { error: "Нет доступа." };
          }
          const id = asString(input.id);
          if (!id) {
            return { error: "Нужен id." };
          }
          const note = await deps.notes.get(actor, id);
          return {
            id: note._id,
            title: note.title,
            body: note.body,
            tags: note.tags,
            status: note.status,
            updatedAt: note.updatedAt,
          };
        } catch (error) {
          return stringifyError(error);
        }
      },
    },
    {
      name: "update_note",
      description: "Обновить заметку суперадмина. Только суперадмин.",
      minRole: "superadmin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
      handler: async (input, ctx) => {
        try {
          const actor = await loadStaff(ctx, deps.staff);
          if (!actor) {
            return { error: "Нет доступа." };
          }
          const id = asString(input.id);
          if (!id) {
            return { error: "Нужен id." };
          }
          const tags = Array.isArray(input.tags)
            ? input.tags.filter((item): item is string => typeof item === "string")
            : undefined;
          const title = asString(input.title);
          const body = asString(input.body);
          const note = await deps.notes.update(actor, id, {
            ...(title ? { title } : {}),
            ...(body ? { body } : {}),
            ...(tags ? { tags } : {}),
          });
          return { id: note._id, title: note.title, tags: note.tags, updated: true };
        } catch (error) {
          return stringifyError(error);
        }
      },
    },
    {
      name: "archive_note",
      description: "Архивировать заметку суперадмина. Только суперадмин.",
      minRole: "superadmin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
      handler: async (input, ctx) => {
        try {
          const actor = await loadStaff(ctx, deps.staff);
          if (!actor) {
            return { error: "Нет доступа." };
          }
          const id = asString(input.id);
          if (!id) {
            return { error: "Нужен id." };
          }
          const note = await deps.notes.archive(actor, id);
          return { id: note._id, archived: true };
        } catch (error) {
          return stringifyError(error);
        }
      },
    },
  ];
}

function stringifyError(error: unknown): { error: string; code?: string } {
  if (error instanceof DomainError) {
    return { error: error.message, code: error.code };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: "Что-то пошло не так." };
}

export function toolsForRole(tools: RegisteredTool[], role: StaffUser["role"]): RegisteredTool[] {
  if (!role) {
    return [];
  }
  return tools.filter((tool) => tool.minRole !== "visitor" && hasAtLeast(role, tool.minRole));
}
