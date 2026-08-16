import { NotFoundError } from "../shared/errors.js";
import type { EscalationService } from "../escalation/escalation.service.js";
import type { SchoolEventRepository } from "./event.repository.js";
import type { ParentRequestKind, SchoolEvent, SchoolEventKind } from "./types.js";

const KIND_RU: Record<SchoolEventKind, string> = {
  attestation: "аттестация",
  competition: "соревнование",
  camp: "лагерь",
};

const EMPTY_RU: Record<SchoolEventKind, string> = {
  attestation: "Ближайших аттестаций в базе нет. Инструкторы сообщат, как появится дата — запишем.",
  competition: "Ближайших стартов в базе нет. Как появится турнир, инструкторы расскажут и запишем.",
  camp: "Ближайшей смены лагеря в базе нет. Как откроют набор, инструкторы напишут.",
};

const SIGNUP_FIELDS: Record<SchoolEventKind, string[]> = {
  attestation: ["child_name", "gyp", "branch", "trainer"],
  competition: ["child_name", "gyp", "branch", "trainer"],
  camp: ["child_name", "branch", "trainer"],
};

const FIELD_ASK: Record<string, string> = {
  child_name: "Как зовут ребёнка — фамилия и имя?",
  gyp: "Какой сейчас гып или пояс?",
  branch: "На каком зале занимаетесь — улица?",
  trainer: "Кто тренер?",
  preferred_date: "Какая дата и время удобны?",
};

export class SchoolEventService {
  constructor(
    private readonly schoolEventDocs: SchoolEventRepository,
    private readonly escalationService: EscalationService,
  ) {}

  async listUpcoming(kind?: SchoolEventKind): Promise<SchoolEvent[]> {
    const filter: { status: "upcoming"; kind?: SchoolEventKind } = { status: "upcoming" };
    if (kind) {
      filter.kind = kind;
    }
    return this.schoolEventDocs.list(filter);
  }

  async upsert(input: {
    id?: string;
    kind: SchoolEventKind;
    title: string;
    dateNote: string;
    place?: string | null;
    note?: string | null;
    actorTelegramId: string;
  }): Promise<SchoolEvent> {
    if (input.id) {
      const updated = await this.schoolEventDocs.update(input.id, {
        kind: input.kind,
        title: input.title,
        dateNote: input.dateNote,
        place: input.place ?? null,
        note: input.note ?? null,
        status: "upcoming",
        updatedByTelegramId: input.actorTelegramId,
      });
      if (!updated) {
        throw new NotFoundError("Такого события нет.");
      }
      return updated;
    }
    return this.schoolEventDocs.insert({
      kind: input.kind,
      title: input.title,
      dateNote: input.dateNote,
      place: input.place ?? null,
      note: input.note ?? null,
      status: "upcoming",
      createdByTelegramId: input.actorTelegramId,
      updatedByTelegramId: input.actorTelegramId,
    });
  }

  async close(id: string, actorTelegramId: string): Promise<SchoolEvent> {
    const updated = await this.schoolEventDocs.update(id, {
      status: "closed",
      updatedByTelegramId: actorTelegramId,
    });
    if (!updated) {
      throw new NotFoundError("Такого события нет.");
    }
    return updated;
  }

  format(event: SchoolEvent): string {
    const place = event.place ? `\nЗал: ${event.place}` : "";
    const note = event.note ? `\n${event.note}` : "";
    return `**${event.title}** · ${KIND_RU[event.kind]}\n${event.dateNote}${place}${note}`;
  }

  emptyMessage(kind: SchoolEventKind): string {
    return EMPTY_RU[kind];
  }

  async submitParentRequest(input: {
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
  }): Promise<{ done: boolean; parent_message: string; missing?: string; events?: Array<{ id: string; text: string }> }> {
    const parentChatId = input.parentChatId ?? input.parentTelegramId;
    if (input.kind === "holiday") {
      await this.escalationService.open({
        parentTelegramId: input.parentTelegramId,
        parentChatId,
        parentUsername: input.parentUsername,
        parentDisplayName: input.parentDisplayName,
        question: input.note ?? "Занимаемся на каникулах?",
        reason: "Каникулы — уточнить у штаба.",
      });
      return { done: true, parent_message: "Сейчас уточню у администрации и напишу сюда." };
    }

    if (input.kind === "personal") {
      const missing = missingOf(
        { trainer: input.trainer, preferred_date: input.preferredDate, child_name: input.childName },
        ["child_name", "trainer", "preferred_date"],
      );
      if (missing) {
        return { done: false, parent_message: FIELD_ASK[missing] ?? "Уточни, пожалуйста.", missing };
      }
      await this.escalationService.open({
        parentTelegramId: input.parentTelegramId,
        parentChatId,
        parentUsername: input.parentUsername,
        parentDisplayName: input.parentDisplayName,
        question: [
          "Заявка на персональную / взрослые",
          `Ребёнок: ${input.childName}`,
          `Тренер: ${input.trainer}`,
          `Когда удобно: ${input.preferredDate}`,
          input.note ? `Комментарий: ${input.note}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        reason: "Персоналка. Тренер потом сам напишет родителю.",
      });
      return {
        done: true,
        parent_message: "Записал. Передал администрации — тренер сам напишет, как подтвердят время.",
      };
    }

    const events = await this.listUpcoming(input.kind);
    if (events.length === 0) {
      return { done: true, parent_message: this.emptyMessage(input.kind) };
    }
    if (!input.eventId) {
      return {
        done: false,
        parent_message: "На какое именно? Назови дату или зал.",
        events: events.map((item) => ({ id: item._id, text: this.format(item) })),
      };
    }
    const event = events.find((item) => item._id === input.eventId);
    if (!event) {
      return { done: false, parent_message: this.emptyMessage(input.kind) };
    }
    const collected = {
      child_name: input.childName,
      gyp: input.gyp,
      branch: input.branch,
      trainer: input.trainer,
    };
    const missing = missingOf(collected, SIGNUP_FIELDS[input.kind]);
    if (missing) {
      return { done: false, parent_message: FIELD_ASK[missing] ?? "Уточни, пожалуйста.", missing };
    }
    await this.escalationService.open({
      parentTelegramId: input.parentTelegramId,
      parentChatId,
      parentUsername: input.parentUsername,
      parentDisplayName: input.parentDisplayName,
      question: [
        `Запись: ${KIND_RU[input.kind]}`,
        event.title,
        event.dateNote,
        `ФИО: ${input.childName}`,
        input.gyp ? `Гып/пояс: ${input.gyp}` : "",
        `Зал: ${input.branch}`,
        `Тренер: ${input.trainer}`,
        input.note ? `Комментарий: ${input.note}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      reason: "Запись родителя. Обработать и подтвердить.",
    });
    return {
      done: true,
      parent_message: "Записал заявку. Администрация посмотрит и вернёмся с подтверждением.",
    };
  }
}

function missingOf(values: Record<string, string | undefined>, keys: string[]): string | null {
  for (const key of keys) {
    const value = values[key];
    if (!value || value.trim().length === 0) {
      return key;
    }
  }
  return null;
}
