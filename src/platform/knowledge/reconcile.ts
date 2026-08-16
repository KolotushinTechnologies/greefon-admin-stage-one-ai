import { normalizeLookup } from "../org/text-match.js";
import type { OrgRepository } from "../org/org.repository.js";
import { docFields } from "./compose.js";
import type { KnowledgeRepository } from "./knowledge.repository.js";
import type { KnowledgeService } from "./knowledge.service.js";
import type { KnowledgeDoc, KnowledgeField } from "./types.js";

const DROP_TITLES = new Set(
  ["Состав тренеров — откуда брать", "Филиалы Грифон с сайта"].map((title) => normalizeLookup(title)),
);

const DAY_RU: Record<string, string> = {
  mon: "пн",
  tue: "вт",
  wed: "ср",
  thu: "чт",
  fri: "пт",
  sat: "сб",
  sun: "вс",
};

export async function reconcileKnowledge(
  docs: KnowledgeRepository,
  knowledge: KnowledgeService,
  org: OrgRepository,
): Promise<{ merged: number; removed: number; branches: number; groups: number }> {
  const all = await knowledge.listActive();
  let removed = 0;
  let merged = 0;

  for (const doc of all) {
    if (shouldDrop(doc)) {
      await knowledge.remove(doc._id, "system");
      removed += 1;
    }
  }

  await refreshCanonicalBodies(knowledge);

  const leftover = await knowledge.listActive();
  const buckets = new Map<string, KnowledgeDoc[]>();
  for (const doc of leftover) {
    const key = normalizeLookup(doc.title);
    if (key.length === 0) {
      continue;
    }
    const bucket = buckets.get(key) ?? [];
    bucket.push(doc);
    buckets.set(key, bucket);
  }

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) {
      continue;
    }
    const ranked = [...bucket].sort((a, b) => scoreDoc(b) - scoreDoc(a));
    const winner = ranked[0];
    if (!winner) {
      continue;
    }
    const fields = mergeFields(ranked);
    await knowledge.upsert({
      id: winner._id,
      title: pickTitle(ranked),
      body: ranked.map((item) => item.body.trim()).sort((a, b) => b.length - a.length)[0] ?? winner.body,
      fields,
      kind: winner.kind,
      namespace: winner.namespace,
      actorTelegramId: "system",
    });
    for (const extra of ranked.slice(1)) {
      await knowledge.remove(extra._id, "system");
      merged += 1;
    }
  }

  const branches = await ensureBranchCards(docs, knowledge, org);
  await fillBranchGeo(knowledge);
  const scheduleCount = await snapshotSchedule(knowledge, org);
  return { merged, removed, branches, groups: scheduleCount };
}

function shouldDrop(doc: KnowledgeDoc): boolean {
  const title = normalizeLookup(doc.title);
  if (DROP_TITLES.has(title)) {
    return true;
  }
  return /^test\d*$/i.test(doc.title.trim());
}

function scoreDoc(doc: KnowledgeDoc): number {
  const yo = doc.title.includes("ё") || doc.title.includes("Ё") ? 3 : 0;
  return docFields(doc.fields).length * 20 + doc.body.trim().length + yo;
}

function pickTitle(docs: KnowledgeDoc[]): string {
  const withYo = docs.find((item) => item.title.includes("ё") || item.title.includes("Ё"));
  return withYo?.title ?? docs[0]?.title ?? "";
}

function mergeFields(docs: KnowledgeDoc[]): KnowledgeField[] {
  const map = new Map<string, KnowledgeField>();
  for (const doc of docs) {
    for (const field of docFields(doc.fields)) {
      const key = normalizeLookup(field.key);
      const current = map.get(key);
      if (!current || current.value.trim().length < field.value.trim().length) {
        map.set(key, field);
      }
    }
  }
  return [...map.values()];
}

async function refreshCanonicalBodies(knowledge: KnowledgeService): Promise<void> {
  const faqs = await knowledge.listActive({ kind: "faq" });
  const hallFaq = faqs.find((item) => item.title === "Как найти зал");
  if (hallFaq && /не угадывать дорогу/i.test(hallFaq.body)) {
    await knowledge.upsert({
      id: hallFaq._id,
      title: hallFaq.title,
      body: `Как доехать — смотри карточку филиала: поля адрес, метро, вход, ориентир.

Есть метро или адрес — назови их. Пошаговый маршрут от дома родителя не строй.

Нет метро/входа в карточке — так и скажи, не угадывай станцию. Не говори, что адреса нет, если поле адрес заполнено.`,
      fields: docFields(hallFaq.fields),
      kind: hallFaq.kind,
      namespace: hallFaq.namespace,
      actorTelegramId: "system",
    });
  }
  const schoolDoc = faqs.find((item) => item.title === "Школа Грифон — о школе");
  if (schoolDoc && /кузнечн|туристск|луначар|не с главной сайта/i.test(schoolDoc.body)) {
    await knowledge.upsert({
      id: schoolDoc._id,
      title: schoolDoc.title,
      body: `Школа тхэквондо «Грифон» в Санкт-Петербурге. С 2015 года, Федерация тхэквондо МФТ / ITF.

Дети с 3 лет, есть взрослые и персональные тренировки. Пробное занятие бесплатное.

Слоган: сделаем ребёнка здоровым, смелым и сильным. Не только физика: команда, дружба, характер.

Руководитель — Смышляев Сергей Николаевич. Адреса залов и кто ведёт группу — отдельные карточки филиалов и расписание в Базе Знаний, здесь их не дублируем.`,
      fields: docFields(schoolDoc.fields),
      kind: schoolDoc.kind,
      namespace: schoolDoc.namespace,
      actorTelegramId: "system",
    });
  }
}

async function ensureBranchCards(
  docs: KnowledgeRepository,
  knowledge: KnowledgeService,
  org: OrgRepository,
): Promise<number> {
  const live = await org.listBranches(false);
  let created = 0;
  for (const branch of live) {
    const byId = (await docs.searchStructured({ kind: "branch", branchId: branch._id }))[0];
    if (byId) {
      continue;
    }
    const folded = normalizeLookup(branch.name);
    const named = (await knowledge.listActive({ kind: "branch" })).find(
      (item) => normalizeLookup(item.title) === folded,
    );
    if (named) {
      await knowledge.upsert({
        id: named._id,
        title: branch.name,
        body: named.body,
        fields: docFields(named.fields),
        kind: "branch",
        namespace: "parents",
        branchId: branch._id,
        actorTelegramId: "system",
      });
      continue;
    }
    await knowledge.upsert({
      title: branch.name,
      body: "",
      fields: [{ key: "адрес", value: branch.name }],
      kind: "branch",
      namespace: "parents",
      branchId: branch._id,
      actorTelegramId: "system",
    });
    created += 1;
  }
  return created;
}

const BRANCH_GEO: Array<{ match: RegExp; fields: Array<{ key: string; value: string }> }> = [
  { match: /байконур/i, fields: [{ key: "метро", value: "Пионерская" }] },
  { match: /дыбенко/i, fields: [{ key: "метро", value: "Дыбенко" }] },
  { match: /зв[её]здн/i, fields: [{ key: "метро", value: "Звёздная, Купчино, Московская" }] },
  { match: /кузнечн/i, fields: [{ key: "метро", value: "Владимирская / Достоевская" }] },
  { match: /707|архивн/i, fields: [{ key: "метро", value: "Дыбенко" }] },
  {
    match: /энгельс/i,
    fields: [
      { key: "метро", value: "Озерки, Удельная" },
      { key: "ориентир", value: "собственное пространство школы" },
    ],
  },
];

async function fillBranchGeo(knowledge: KnowledgeService): Promise<void> {
  const cards = await knowledge.listBranchCards();
  for (const card of cards) {
    const hint = BRANCH_GEO.find((item) => item.match.test(card.title));
    if (!hint) {
      continue;
    }
    const have = new Set(docFields(card.fields).map((field) => field.key.toLowerCase()));
    for (const field of hint.fields) {
      if (!have.has(field.key.toLowerCase())) {
        await knowledge.setField({
          id: card._id,
          key: field.key,
          value: field.value,
          actorTelegramId: "system",
        });
      }
    }
  }
}

async function snapshotSchedule(knowledge: KnowledgeService, org: OrgRepository): Promise<number> {
  const existing = await knowledge.listScheduleCards();
  if (existing.length > 0) {
    return 0;
  }
  const branches = await org.listBranches(false);
  const groups = await org.listGroups();
  const instructors = await org.listInstructors();
  let created = 0;
  for (const group of groups) {
    const branch = branches.find((item) => item._id === group.branchId);
    if (!branch) {
      continue;
    }
    const instructor = group.instructorId ? instructors.find((item) => item._id === group.instructorId) : null;
    const weekdays = group.localOverride?.weekdays ?? group.weekdays;
    const timeNote = group.localOverride?.timeNote ?? group.timeNote;
    const fields = [
      { key: "филиал", value: branch.name },
      { key: "группа", value: group.name },
    ];
    if (weekdays.length > 0) {
      fields.push({ key: "дни", value: weekdays.map((day) => DAY_RU[day] ?? day).join(", ") });
    }
    if (timeNote && timeNote.trim().length > 0) {
      fields.push({ key: "время", value: timeNote.trim() });
    }
    if (instructor) {
      fields.push({ key: "тренер", value: instructor.name });
    }
    await knowledge.upsert({
      title: `${branch.name} · ${group.name}`,
      body: "",
      fields,
      kind: "schedule",
      namespace: "parents",
      branchId: branch._id,
      groupId: group._id,
      actorTelegramId: "system",
    });
    created += 1;
  }
  return created;
}
