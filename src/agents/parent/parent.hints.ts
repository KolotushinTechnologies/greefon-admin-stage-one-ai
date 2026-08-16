import { InlineKeyboard } from "grammy";
import { docFields } from "../../platform/knowledge/compose.js";
import {
  isMasterKnowledgeTitle,
  isPersonKnowledgeDoc,
  type KnowledgeService,
} from "../../platform/knowledge/knowledge.service.js";
import type { ScheduleService } from "../../platform/org/schedule.service.js";
import type { SchoolEventService } from "../../platform/events/event.service.js";
import type { ConversationStore } from "../../platform/conversation/conversation.store.js";
import { yandexRouteFromHereUrl } from "../../platform/org/yandex-maps.js";
import type { AgentToolTrace } from "../../platform/agent-runtime/types.js";

export type ParentHintReply = {
  text: string;
  inline?: InlineKeyboard;
};

export class ParentHints {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly schedule: ScheduleService,
    private readonly schoolEvents: SchoolEventService,
    private readonly conversations: ConversationStore,
  ) {}

  fromTools(tools: AgentToolTrace[]): InlineKeyboard | undefined {
    for (const item of [...tools].reverse()) {
      if (item.name === "list_branches") {
        const halls = asHalls(item.result);
        if (halls.length === 1 && halls[0]) {
          return hallActions(halls[0].id, halls[0].address);
        }
        if (halls.length > 1) {
          return hallList(halls);
        }
      }
      if (item.name === "list_instructors") {
        const people = asPeople(item.result);
        if (people.length > 0) {
          return peopleList(people);
        }
      }
      if (item.name === "list_events") {
        const events = asEvents(item.result);
        if (events.length > 0) {
          return eventList(events);
        }
      }
    }
    return undefined;
  }

  async handle(data: string, telegramUserId: string): Promise<ParentHintReply | null> {
    if (data === "p:halls") {
      const halls = (await this.knowledge.listBranchCards()).map((item) => ({
        id: item._id,
        name: item.title,
        address: fieldOf(item.fields, "адрес") ?? item.title,
      }));
      return { text: "Какой зал?", inline: hallList(halls) };
    }
    if (data === "p:trainers") {
      const people = (await this.knowledge.listStaffProfiles()).map((item) => ({
        id: item._id,
        name: item.title,
      }));
      return { text: "Кто из тренеров?", inline: peopleList(people) };
    }
    const hall = /^p:b:(.+)$/.exec(data);
    if (hall?.[1]) {
      return this.hallCard(hall[1], telegramUserId);
    }
    const schedule = /^p:s:(.+)$/.exec(data);
    if (schedule?.[1]) {
      return this.hallSchedule(schedule[1]);
    }
    const trainer = /^p:t:(.+)$/.exec(data);
    if (trainer?.[1]) {
      return this.trainerCard(trainer[1]);
    }
    const event = /^p:e:(.+)$/.exec(data);
    if (event?.[1]) {
      return this.eventCard(event[1]);
    }
    return null;
  }

  private async hallCard(id: string, telegramUserId: string): Promise<ParentHintReply> {
    const doc = await this.knowledge.getActive(id);
    if (!doc || doc.kind !== "branch") {
      return { text: "Такой зал в базе не нашёл." };
    }
    const address = fieldOf(doc.fields, "адрес") ?? doc.title;
    await this.conversations.setRouteAddress(telegramUserId, address);
    const metro = fieldOf(doc.fields, "метро");
    const entrance = fieldOf(doc.fields, "вход");
    const landmark = fieldOf(doc.fields, "ориентир");
    const lines = [`**${doc.title}**`, `Адрес: ${address}`];
    if (metro) {
      lines.push(`Метро: ${metro}`);
    }
    if (entrance) {
      lines.push(`Вход: ${entrance}`);
    }
    if (landmark) {
      lines.push(`Ориентир: ${landmark}`);
    }
    return { text: lines.join("\n"), inline: hallActions(doc._id, address) };
  }

  private async hallSchedule(id: string): Promise<ParentHintReply> {
    const doc = await this.knowledge.getActive(id);
    if (!doc) {
      return { text: "Зал не нашёл." };
    }
    const text = await this.schedule.describe({ branchHint: doc.title });
    return {
      text,
      inline: hintButtons([
        { text: "Про зал", data: `p:b:${id}` },
        { text: "Все залы", data: "p:halls" },
      ]),
    };
  }

  private async trainerCard(id: string): Promise<ParentHintReply> {
    const doc = await this.knowledge.getActive(id);
    if (!doc || !isPersonKnowledgeDoc(doc) || isMasterKnowledgeTitle(doc.title)) {
      return { text: "Такого тренера в базе нет." };
    }
    const fields = docFields(doc.fields)
      .filter((field) => field.key !== "роль")
      .map((field) => `${field.key}: ${field.value}`);
    const role = docFields(doc.fields).find((field) => field.key === "роль")?.value;
    const body = doc.body.trim();
    const text = [
      `**${doc.title}**`,
      role ? `роль: ${role}` : null,
      ...fields,
      body,
    ]
      .filter((line): line is string => Boolean(line && line.length > 0))
      .join("\n");
    return {
      text: text.length > 0 ? text : `**${doc.title}**`,
      inline: hintButtons([{ text: "Все тренеры", data: "p:trainers" }]),
    };
  }

  private async eventCard(id: string): Promise<ParentHintReply> {
    const events = await this.schoolEvents.listUpcoming();
    const found = events.find((item) => item._id === id);
    if (!found) {
      return { text: "Этого события уже нет в ближайших." };
    }
    return {
      text: `${this.schoolEvents.format(found)}\n\nЧтобы записать ребёнка — напиши «запиши на это».`,
    };
  }
}

type HallHint = { id: string; name: string; address: string };
type PersonHint = { id: string; name: string };
type EventHint = { id: string; text: string };

function hallList(halls: HallHint[]): InlineKeyboard {
  return hintButtons(halls.slice(0, 12).map((item) => ({ text: item.name, data: `p:b:${item.id}` })));
}

function peopleList(people: PersonHint[]): InlineKeyboard {
  return hintButtons(people.slice(0, 12).map((item) => ({ text: shortName(item.name), data: `p:t:${item.id}` })));
}

function eventList(events: EventHint[]): InlineKeyboard {
  return hintButtons(
    events.slice(0, 8).map((item) => ({
      text: item.text.replace(/\*\*/g, "").split("\n")[0] ?? "Событие",
      data: `p:e:${item.id}`,
    })),
  );
}

function hintButtons(items: Array<{ text: string; data: string }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of items) {
    if (item.data.length > 64) {
      continue;
    }
    const label = item.text.length > 42 ? `${item.text.slice(0, 41)}…` : item.text;
    keyboard.text(label, item.data).row();
  }
  return keyboard;
}

function hallActions(id: string, address: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const route = yandexRouteFromHereUrl(address);
  if (route) {
    keyboard.url("Маршрут", route).row();
  }
  keyboard.text("Расписание", `p:s:${id}`).text("Все залы", "p:halls");
  return keyboard;
}

function fieldOf(fields: Array<{ key: string; value: string }> | undefined, key: string): string | undefined {
  return docFields(fields).find((item) => item.key.toLowerCase() === key.toLowerCase())?.value;
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) {
    return name;
  }
  return `${parts[0]} ${parts[1]}`;
}

function asHalls(result: unknown): HallHint[] {
  if (!result || typeof result !== "object" || !("halls" in result) || !Array.isArray(result.halls)) {
    return [];
  }
  return result.halls.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name : "";
    const address = typeof row.address === "string" ? row.address : name;
    if (!id || !name) {
      return [];
    }
    return [{ id, name, address }];
  });
}

function asPeople(result: unknown): PersonHint[] {
  if (!result || typeof result !== "object" || !("people" in result) || !Array.isArray(result.people)) {
    return [];
  }
  return result.people.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name : "";
    if (!id || !name) {
      return [];
    }
    return [{ id, name }];
  });
}

function asEvents(result: unknown): EventHint[] {
  if (!result || typeof result !== "object" || !("events" in result) || !Array.isArray(result.events)) {
    return [];
  }
  return result.events.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const text = typeof row.text === "string" ? row.text : "";
    if (!id) {
      return [];
    }
    return [{ id, text }];
  });
}
