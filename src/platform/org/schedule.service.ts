import { WEEKDAYS, type TrainingGroup, type Weekday } from "./types.js";
import type { OrgRepository } from "./org.repository.js";
import type { TargetResolver } from "./target-resolver.js";
import type { KnowledgeService } from "../knowledge/knowledge.service.js";
import { docFields } from "../knowledge/compose.js";
import { normalizeLookup } from "./text-match.js";
import type { KnowledgeDoc } from "../knowledge/types.js";

const DAY_RU: Record<Weekday, string> = {
  mon: "пн",
  tue: "вт",
  wed: "ср",
  thu: "чт",
  fri: "пт",
  sat: "сб",
  sun: "вс",
};

export class ScheduleService {
  constructor(
    private readonly org: OrgRepository,
    private readonly resolver: TargetResolver,
    private readonly knowledge: KnowledgeService,
  ) {}

  effective(group: TrainingGroup): { weekdays: Weekday[]; timeNote: string | null; note: string | null } {
    return {
      weekdays: group.localOverride?.weekdays ?? group.weekdays,
      timeNote: group.localOverride?.timeNote ?? group.timeNote,
      note: group.localOverride?.note ?? null,
    };
  }

  formatDoc(doc: KnowledgeDoc): string {
    return formatScheduleDoc(doc);
  }

  format(group: TrainingGroup, branchName: string | null, instructorName: string | null): string {
    const effective = this.effective(group);
    const days = effective.weekdays.map((day) => DAY_RU[day]).join(", ") || "дни не указаны";
    const time = effective.timeNote ? `, ${effective.timeNote}` : "";
    const instructor = instructorName ? `\nТренер: ${instructorName}` : "";
    const note = effective.note ? `\nПометка: ${effective.note}` : "";
    const source = group.localOverride ? " (правка через бота)" : "";
    return `${branchName ?? "филиал"} · ${group.name}${source}\n${days}${time}${instructor}${note}`;
  }

  async describe(query: {
    branchHint?: string | undefined;
    groupHint?: string | undefined;
    raw?: string | undefined;
    includeClosed?: boolean | undefined;
  }): Promise<string> {
    const cards = await this.knowledge.listScheduleCards();
    const hint = normalizeLookup([query.raw, query.branchHint, query.groupHint].filter(Boolean).join(" "));
    const filtered = hint.length === 0 ? cards : cards.filter((doc) => scheduleMatches(doc, hint));
    if (filtered.length === 0) {
      return "В Базе Знаний расписания по этому запросу нет. Уточни филиал или поправь карточку расписания.";
    }
    const lines = filtered.slice(0, 15).map((doc) => formatScheduleDoc(doc));
    if (filtered.length > 15) {
      lines.push(`…и ещё ${filtered.length - 15} групп`);
    }
    return lines.join("\n\n");
  }

  async override(input: {
    branchHint?: string | undefined;
    groupHint?: string | undefined;
    raw?: string | undefined;
    weekdays?: Weekday[] | undefined;
    timeNote?: string | null | undefined;
    note?: string | null | undefined;
    actorTelegramId: string;
  }): Promise<string> {
    const resolved = await this.safeResolve(input);
    if (!resolved?.group) {
      return "Не понял, какое расписание менять. Назови филиал и группу.";
    }
    const override: {
      timeNote?: string | null;
      weekdays?: Weekday[];
      note?: string | null;
      updatedByTelegramId: string;
    } = { updatedByTelegramId: input.actorTelegramId };
    if (input.weekdays) {
      override.weekdays = input.weekdays;
    }
    if (input.timeNote !== undefined) {
      override.timeNote = input.timeNote;
    }
    if (input.note !== undefined) {
      override.note = input.note;
    }
    const updated = await this.org.applyGroupOverride(resolved.group._id, override);
    if (!updated) {
      return "Группу не нашёл.";
    }
    const branch = resolved.branch ?? (await this.org.findBranchById(updated.branchId));
    return `Готово. Обновил расписание.\n\n${this.format(updated, branch?.name ?? null, null)}`;
  }

  async overrideByGroupId(input: {
    groupId: string;
    weekdays?: Weekday[] | undefined;
    timeNote?: string | null | undefined;
    note?: string | null | undefined;
    actorTelegramId: string;
  }): Promise<string> {
    const group = await this.org.findGroupById(input.groupId);
    if (!group) {
      return "Группу не нашёл.";
    }
    const override: {
      timeNote?: string | null;
      weekdays?: Weekday[];
      note?: string | null;
      updatedByTelegramId: string;
    } = { updatedByTelegramId: input.actorTelegramId };
    if (input.weekdays) {
      override.weekdays = input.weekdays;
    }
    if (input.timeNote !== undefined) {
      override.timeNote = input.timeNote;
    }
    if (input.note !== undefined) {
      override.note = input.note;
    }
    const updated = await this.org.applyGroupOverride(input.groupId, override);
    if (!updated) {
      return "Группу не нашёл.";
    }
    const branch = await this.org.findBranchById(updated.branchId);
    const instructor = updated.instructorId ? await this.org.findInstructorById(updated.instructorId) : null;
    return `Готово.\n\n${this.format(updated, branch?.name ?? null, instructor?.name ?? null)}`;
  }

  parseWeekdays(raw: string): Weekday[] {
    const map: Record<string, Weekday> = {
      пн: "mon",
      понедельник: "mon",
      вт: "tue",
      вторник: "tue",
      ср: "wed",
      среда: "wed",
      чт: "thu",
      четверг: "thu",
      пт: "fri",
      пятница: "fri",
      сб: "sat",
      суббота: "sat",
      вс: "sun",
      воскресенье: "sun",
    };
    const found = new Set<Weekday>();
    const normalized = raw.toLowerCase();
    for (const [key, day] of Object.entries(map)) {
      if (normalized.includes(key)) {
        found.add(day);
      }
    }
    return WEEKDAYS.filter((day) => found.has(day));
  }

  private async safeResolve(query: {
    branchHint?: string | undefined;
    groupHint?: string | undefined;
    raw?: string | undefined;
    includeClosed?: boolean | undefined;
  }) {
    try {
      return await this.resolver.resolve({
        raw: query.raw,
        branchHint: query.branchHint,
        groupHint: query.groupHint,
        includeClosed: query.includeClosed,
      });
    } catch {
      return null;
    }
  }
}

function scheduleMatches(doc: KnowledgeDoc, hint: string): boolean {
  const blob = normalizeLookup(
    [doc.title, ...docFields(doc.fields).map((field) => `${field.key} ${field.value}`)].join(" "),
  );
  return blob.includes(hint) || hint.split(" ").every((token) => token.length === 0 || blob.includes(token));
}

function formatScheduleDoc(doc: KnowledgeDoc): string {
  const fields = docFields(doc.fields);
  const get = (key: string) => fields.find((field) => field.key === key)?.value;
  const branch = get("филиал");
  const group = get("группа");
  const days = get("дни");
  const time = get("время");
  const coach = get("тренер");
  const head = [branch, group].filter(Boolean).join(" · ") || doc.title;
  const when = [days, time].filter(Boolean).join(", ");
  const lines = [head];
  if (when) {
    lines.push(when);
  }
  if (coach) {
    lines.push(`Тренер: ${coach}`);
  }
  if (doc.body.trim()) {
    lines.push(doc.body.trim());
  }
  return lines.join("\n");
}
