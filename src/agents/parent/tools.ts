import { DomainError } from "../../platform/shared/errors.js";
import type { KnowledgeService } from "../../platform/knowledge/knowledge.service.js";
import type { ScheduleService } from "../../platform/org/schedule.service.js";
import type { EscalationService } from "../../platform/escalation/escalation.service.js";
import type { SchoolEventService } from "../../platform/events/event.service.js";
import type { ParentRequestKind, SchoolEventKind } from "../../platform/events/types.js";
import { yandexPlaceUrl, yandexRouteFromHereUrl } from "../../platform/org/yandex-maps.js";
import type { RegisteredTool } from "../../platform/agent-runtime/types.js";

type Deps = {
  knowledge: KnowledgeService;
  schedule: ScheduleService;
  escalationService: EscalationService;
  schoolEvents: SchoolEventService;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function buildParentTools(deps: Deps): RegisteredTool[] {
  return [
    {
      name: "search_school",
      description:
        "Искать в Базе Знаний: правила, FAQ, тренеры, звания, филиалы. Единственный источник званий и дана. Нет в выдаче — не выдумывай.",
      minRole: "visitor",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: { query: { type: "string" } },
      },
      handler: async (input) => {
        const query = asString(input.query);
        if (!query) {
          return { error: "Пустой запрос." };
        }
        return deps.knowledge.lookup({
          query,
          excludeNamespaces: ["internal"],
        });
      },
    },
    {
      name: "get_schedule",
      description: "Расписание из Базы Знаний.",
      minRole: "visitor",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          raw: { type: "string" },
          branch_hint: { type: "string" },
          group_hint: { type: "string" },
        },
      },
      handler: async (input) => ({
        text: await deps.schedule.describe({
          raw: asString(input.raw),
          branchHint: asString(input.branch_hint),
          groupHint: asString(input.group_hint),
        }),
      }),
    },
    {
      name: "list_branches",
      description:
        "Филиалы: адрес, метро, вход и готовые ссылки Яндекс.Карт. Как доехать — всегда зови. В ответе дай markdown-ссылку maps_route_url («Маршрут в Яндекс.Картах»). Пошаговый путь словами не строй.",
      minRole: "visitor",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { hint: { type: "string" } },
      },
      handler: async (input) => {
        const hint = asString(input.hint);
        let branches = await deps.knowledge.listBranchCards();
        if (hint) {
          const tokens = hint
            .toLowerCase()
            .replace(/ё/g, "е")
            .split(/[^a-zа-я0-9]+/i)
            .filter((token) => token.length >= 4);
          const hit = branches.filter((item) => {
            const hay = `${item.title} ${(item.fields ?? []).map((field) => field.value).join(" ")}`
              .toLowerCase()
              .replace(/ё/g, "е");
            return tokens.some((token) => hay.includes(token));
          });
          if (hit.length > 0) {
            branches = hit;
          }
        }
        return {
          halls: branches.map((item) => {
            const fields = item.fields ?? [];
            const pick = (key: string) => fields.find((field) => field.key.toLowerCase() === key)?.value ?? null;
            const address = pick("адрес") ?? item.title;
            return {
              id: item._id,
              name: item.title,
              address,
              metro: pick("метро"),
              entrance: pick("вход"),
              landmark: pick("ориентир"),
              maps_place_url: yandexPlaceUrl(address),
              maps_route_url: yandexRouteFromHereUrl(address),
              fields,
            };
          }),
        };
      },
    },
    {
      name: "list_instructors",
      description:
        "Состав тренеров из Базы Знаний. В ответе parent_message — полный список: для «кто тренеры» отдай его родителю как есть (можно чуть смягчить тон, но никого не выкидывай). Нет поля в карточке — не выдумывай.",
      minRole: "visitor",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      handler: async () => {
        const people = await deps.knowledge.listStaffProfiles();
        return {
          count: people.length,
          parent_message: deps.knowledge.formatInstructorsRoster(people),
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
      name: "list_events",
      description:
        "Ближайшие аттестации, соревнования или смены лагеря из Базы событий. Пустой список — дат нет, не выдумывай.",
      minRole: "visitor",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["attestation", "competition", "camp"] },
        },
      },
      handler: async (input) => {
        const kind = asString(input.kind) as SchoolEventKind | undefined;
        const events = await deps.schoolEvents.listUpcoming(kind);
        if (events.length === 0) {
          return {
            empty: true,
            parent_message: kind
              ? deps.schoolEvents.emptyMessage(kind)
              : "Ближайших дат в базе нет. Инструкторы сообщат, как появится.",
          };
        }
        return {
          events: events.map((item) => ({
            id: item._id,
            kind: item.kind,
            text: deps.schoolEvents.format(item),
          })),
        };
      },
    },
    {
      name: "submit_request",
      description:
        "Заявка: аттестация / старт / лагерь / персоналка / каникулы. Сначала собери недостающие поля по одному, потом вызови с полным набором.",
      minRole: "visitor",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: {
          kind: { type: "string", enum: ["attestation", "competition", "camp", "personal", "holiday"] },
          event_id: { type: "string" },
          child_name: { type: "string" },
          gyp: { type: "string" },
          branch: { type: "string" },
          trainer: { type: "string" },
          preferred_date: { type: "string" },
          note: { type: "string" },
        },
      },
      handler: async (input, ctx) => {
        const kind = asString(input.kind) as ParentRequestKind | undefined;
        if (!kind) {
          return { error: "Нужен тип заявки." };
        }
        const request: {
          kind: ParentRequestKind;
          eventId?: string;
          childName?: string;
          gyp?: string;
          branch?: string;
          trainer?: string;
          preferredDate?: string;
          note?: string;
          parentTelegramId: string;
          parentChatId?: string;
          parentUsername: string | null;
          parentDisplayName: string | null;
        } = {
          kind,
          parentTelegramId: ctx.telegramUserId,
          parentUsername: ctx.username,
          parentDisplayName: ctx.displayName,
        };
        if (ctx.chatId) {
          request.parentChatId = ctx.chatId;
        }
        const eventId = asString(input.event_id);
        if (eventId) {
          request.eventId = eventId;
        }
        const childName = asString(input.child_name);
        if (childName) {
          request.childName = childName;
        }
        const gyp = asString(input.gyp);
        if (gyp) {
          request.gyp = gyp;
        }
        const branch = asString(input.branch);
        if (branch) {
          request.branch = branch;
        }
        const trainer = asString(input.trainer);
        if (trainer) {
          request.trainer = trainer;
        }
        const preferredDate = asString(input.preferred_date);
        if (preferredDate) {
          request.preferredDate = preferredDate;
        }
        const note = asString(input.note);
        if (note) {
          request.note = note;
        }
        return deps.schoolEvents.submitParentRequest(request);
      },
    },
    {
      name: "read_link",
      description:
        "Прочитать страницу по HTTPS-ссылке из объявления или Базы (налоговый вычет, FAQ). Для «как работает вычет / что это» — сначала read_link, не escalate_to_staff.",
      minRole: "visitor",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: { url: { type: "string" } },
      },
      handler: async (input) => {
        const url = asString(input.url);
        if (!url) {
          return { error: "Нужна ссылка." };
        }
        try {
          const text = await fetchPageText(url);
          return { url, text, hint: "Кратко перескажи родителю своими словами и оставь ссылку. Не эскалируй, если не просили документы от школы." };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : "Страницу не открыл.",
            hint: "Объясни по тексту объявления, что есть; ссылку всё равно дай. escalate только если просят справку/документы от школы.",
          };
        }
      },
    },
    {
      name: "escalate_to_staff",
      description:
        "Только конкретная просьба штабу: справка/документы от школы, выдать бумаги на вычет, возврат денег, жалоба, директор, конфликт, травма, «передайте админам». НЕ для общих «как работает вычет».",
      minRole: "visitor",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["question", "reason"],
        properties: {
          question: { type: "string" },
          reason: { type: "string" },
        },
      },
      handler: async (input, ctx) => {
        const question = asString(input.question);
        const reason = asString(input.reason);
        if (!question) {
          return { error: "Нужен вопрос родителя." };
        }
        await deps.escalationService.open({
          parentTelegramId: ctx.telegramUserId,
          parentChatId: ctx.chatId ?? ctx.telegramUserId,
          parentMessageId: ctx.messageId ?? null,
          parentUsername: ctx.username,
          parentDisplayName: ctx.displayName,
          question,
          reason: reason ?? "Конкретная просьба родителя.",
        });
        return {
          escalated: true,
          parent_message:
            "Принял — уже передал коллегам, разберёмся и я вернусь сюда. Если ещё что-то нужно по ходу — пиши.",
        };
      },
    },
  ];
}

async function fetchPageText(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Кривая ссылка.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Только http/https.");
  }
  const response = await fetch(parsed.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": "GreefonBot/1.0 (+https://greefon.com)",
    },
  });
  if (!response.ok) {
    throw new Error(`Страница ответила ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (!/html|text|xml/i.test(contentType) && body.trim().startsWith("<") === false) {
    return body.slice(0, 6000);
  }
  return stripHtmlToText(body).slice(0, 8000);
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function stringifyParentError(error: unknown): { error: string } {
  if (error instanceof DomainError) {
    return { error: error.message };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: "Не получилось." };
}
