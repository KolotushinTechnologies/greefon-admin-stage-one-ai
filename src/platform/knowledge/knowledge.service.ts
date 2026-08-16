import type { JobQueues } from "../../infrastructure/bullmq/queues.js";
import type { RabbitEventBus } from "../../infrastructure/rabbitmq/event-bus.js";
import type { XenovaEmbeddingService } from "../../infrastructure/embeddings/xenova.embeddings.js";
import { NotFoundError } from "../shared/errors.js";
import { normalizeLookup } from "../org/text-match.js";
import { chunkDocument } from "./chunker.js";
import { composeKnowledgeText, docFields, normalizeFieldKey } from "./compose.js";
import type { KnowledgeRepository } from "./knowledge.repository.js";
import type { KnowledgeDoc, KnowledgeField, KnowledgeKind, KnowledgeNamespace, RetrievedChunk } from "./types.js";

export class KnowledgeService {
  constructor(
    private readonly knowledgeDocs: KnowledgeRepository,
    private readonly embeddings: XenovaEmbeddingService,
    private readonly queues: JobQueues,
    private readonly events: RabbitEventBus,
  ) {}

  async upsert(input: {
    id?: string;
    title: string;
    body: string;
    fields?: KnowledgeField[];
    kind: KnowledgeKind;
    namespace?: KnowledgeNamespace;
    branchId?: string | null;
    groupId?: string | null;
    actorTelegramId: string;
  }): Promise<KnowledgeDoc> {
    const namespace = input.namespace ?? "admin";
    if (input.id) {
      const patch: Parameters<KnowledgeRepository["updateDoc"]>[1] = {
        title: input.title,
        body: input.body,
        kind: input.kind,
        namespace,
        branchId: input.branchId ?? null,
        groupId: input.groupId ?? null,
        status: "active",
        updatedByTelegramId: input.actorTelegramId,
      };
      if (input.fields) {
        patch.fields = input.fields;
      }
      const doc = await this.knowledgeDocs.updateDoc(input.id, patch);
      if (!doc) {
        throw new NotFoundError("Такой записи в базе знаний нет.");
      }
      await this.afterChange(doc);
      return doc;
    }
    const doc = await this.knowledgeDocs.insertDoc({
      namespace,
      kind: input.kind,
      title: input.title,
      body: input.body,
      fields: input.fields ?? [],
      branchId: input.branchId ?? null,
      groupId: input.groupId ?? null,
      status: "active",
      createdByTelegramId: input.actorTelegramId,
      updatedByTelegramId: input.actorTelegramId,
    });
    await this.afterChange(doc);
    return doc;
  }

  async setField(input: {
    id?: string;
    title?: string;
    key: string;
    value: string;
    actorTelegramId: string;
  }): Promise<KnowledgeDoc> {
    const doc = await this.resolveDoc(input.id, input.title);
    const key = normalizeFieldKey(input.key);
    if (key.length === 0) {
      throw new NotFoundError("Нужно название поля.");
    }
    const fields = [...docFields(doc.fields)];
    const index = fields.findIndex((field) => field.key.toLowerCase() === key.toLowerCase());
    if (index >= 0) {
      const current = fields[index];
      if (current) {
        fields[index] = { key: current.key, value: input.value.trim() };
      }
    } else {
      fields.push({ key, value: input.value.trim() });
    }
    const updated = await this.knowledgeDocs.updateDoc(doc._id, {
      fields,
      updatedByTelegramId: input.actorTelegramId,
    });
    if (!updated) {
      throw new NotFoundError("Такой записи в базе знаний нет.");
    }
    await this.afterChange(updated);
    return updated;
  }

  async removeField(input: {
    id?: string;
    title?: string;
    key?: string;
    index?: number;
    actorTelegramId: string;
  }): Promise<KnowledgeDoc> {
    const doc = await this.resolveDoc(input.id, input.title);
    const fields = [...docFields(doc.fields)];
    let next = fields;
    if (input.index !== undefined) {
      next = fields.filter((_, idx) => idx !== input.index);
    } else if (input.key) {
      const key = normalizeFieldKey(input.key).toLowerCase();
      next = fields.filter((field) => field.key.toLowerCase() !== key);
    }
    if (next.length === fields.length) {
      throw new NotFoundError("Такого поля нет.");
    }
    const updated = await this.knowledgeDocs.updateDoc(doc._id, {
      fields: next,
      updatedByTelegramId: input.actorTelegramId,
    });
    if (!updated) {
      throw new NotFoundError("Такой записи в базе знаний нет.");
    }
    await this.afterChange(updated);
    return updated;
  }

  async ensureRosterProfiles(names: string[], actorTelegramId: string): Promise<number> {
    let created = 0;
    for (const name of names) {
      const title = name.trim();
      if (title.length === 0 || /^test\d*$/i.test(title)) {
        continue;
      }
      const existing = await this.findFolded(title);
      if (existing) {
        continue;
      }
      await this.upsert({
        title,
        body: "",
        fields: [{ key: "роль", value: "тренер" }],
        kind: "faq",
        namespace: "parents",
        actorTelegramId,
      });
      created += 1;
    }
    return created;
  }

  async remove(id: string, actorTelegramId: string): Promise<void> {
    const doc = await this.knowledgeDocs.updateDoc(id, { status: "deleted", updatedByTelegramId: actorTelegramId });
    if (!doc) {
      throw new NotFoundError("Такой записи в базе знаний нет.");
    }
    await this.knowledgeDocs.deleteChunks(id);
    await this.events.publish("knowledge.changed", { docId: id, kind: doc.kind, deleted: true });
  }

  async profileByTitle(title: string): Promise<{ title: string; fields: KnowledgeField[]; body: string } | null> {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const doc = await this.findFolded(trimmed);
    if (!doc) {
      return null;
    }
    return { title: doc.title, fields: docFields(doc.fields), body: doc.body };
  }

  async getActive(id: string): Promise<KnowledgeDoc | null> {
    const doc = await this.knowledgeDocs.findDoc(id);
    if (!doc || doc.status !== "active") {
      return null;
    }
    return doc;
  }

  async listStaffProfiles(
    input: { excludeNamespaces?: KnowledgeNamespace[]; includeMaster?: boolean } = {},
  ): Promise<KnowledgeDoc[]> {
    const exclude = input.excludeNamespaces ?? ["internal"];
    const docs = await this.listActive({ excludeNamespaces: exclude });
    return docs
      .filter((doc) => {
        if (!isPersonKnowledgeDoc(doc)) {
          return false;
        }
        if (!input.includeMaster && isMasterKnowledgeTitle(doc.title)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }

  /** Готовый текст состава — карточка целиком из Базы, не урезанный «дан, КМС». */
  formatInstructorsRoster(people: KnowledgeDoc[]): string {
    if (people.length === 0) {
      return "В Базе Знаний пока нет карточек тренеров. Уточню у администрации.";
    }
    const header = "Состав школы «Грифон» (из Базы Знаний):";
    const footer = "Если хочешь узнать, кто ведёт занятия в конкретном зале или группе — спроси.";
    // Telegram ~4096; подбираем длину body, чтобы все влезли.
    for (const bodyLimit of [600, 420, 280, 180, 120]) {
      const blocks = people.map((doc) => formatInstructorCard(doc, bodyLimit));
      const text = [header, "", ...interleaveBlank(blocks), "", footer].join("\n");
      if (text.length <= 3800 || bodyLimit === 120) {
        return text.length <= 4090 ? text : `${text.slice(0, 4088).trimEnd()}…`;
      }
    }
    return header;
  }

  async listBranchCards(): Promise<KnowledgeDoc[]> {
    return this.listActive({ kind: "branch" });
  }

  async listScheduleCards(): Promise<KnowledgeDoc[]> {
    return this.listActive({ kind: "schedule" });
  }

  /** Категории для UI Базы знаний (людей отделяем от FAQ и тем). */
  async listByCategory(
    category: KnowledgeUiCategory,
    input: { excludeNamespaces?: KnowledgeNamespace[] } = {},
  ): Promise<KnowledgeDoc[]> {
    const docs = await this.listActive(
      input.excludeNamespaces ? { excludeNamespaces: input.excludeNamespaces } : {},
    );
    return docs
      .filter((doc) => knowledgeUiCategory(doc) === category)
      .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }

  async categoryCounts(input: { excludeNamespaces?: KnowledgeNamespace[] } = {}): Promise<Record<KnowledgeUiCategory, number>> {
    const docs = await this.listActive(
      input.excludeNamespaces ? { excludeNamespaces: input.excludeNamespaces } : {},
    );
    const counts: Record<KnowledgeUiCategory, number> = {
      people: 0,
      branch: 0,
      faq: 0,
      topic: 0,
      schedule: 0,
      other: 0,
    };
    for (const doc of docs) {
      counts[knowledgeUiCategory(doc)] += 1;
    }
    return counts;
  }

  /**
   * Чинит карточки людей, ошибочно сохранённые как topic
   * (например «Иванов Иван Иванович» в «Темах»).
   */
  async repairMisclassifiedPeople(actorTelegramId = "system"): Promise<number> {
    const topics = await this.listActive({ kind: "topic" });
    let fixed = 0;
    for (const doc of topics) {
      if (!looksLikePersonTitle(doc.title) && !isPersonKnowledgeDoc(doc)) {
        continue;
      }
      const fields = [...docFields(doc.fields)];
      if (!fields.some((field) => field.key === "роль")) {
        fields.push({ key: "роль", value: "тренер" });
      }
      await this.upsert({
        id: doc._id,
        title: doc.title,
        body: doc.body,
        fields,
        kind: "faq",
        namespace: doc.namespace === "parents" ? "admin" : doc.namespace,
        branchId: doc.branchId,
        groupId: doc.groupId,
        actorTelegramId,
      });
      fixed += 1;
    }
    return fixed;
  }

  /**
   * Карточки Мастера / Колотушина — только internal: агент знает, кнопки Базы — нет.
   */
  async ensureMasterDocsHidden(actorTelegramId = "system"): Promise<number> {
    const docs = await this.listActive({});
    let fixed = 0;
    for (const doc of docs) {
      if (doc.namespace === "internal") {
        continue;
      }
      if (!isMasterKnowledgeTitle(doc.title)) {
        continue;
      }
      await this.upsert({
        id: doc._id,
        title: doc.title,
        body: doc.body,
        fields: docFields(doc.fields),
        kind: doc.kind === "topic" ? "faq" : doc.kind,
        namespace: "internal",
        branchId: doc.branchId,
        groupId: doc.groupId,
        actorTelegramId,
      });
      fixed += 1;
    }
    return fixed;
  }

  async listActive(input: { kind?: KnowledgeKind; excludeNamespaces?: KnowledgeNamespace[] } = {}): Promise<KnowledgeDoc[]> {
    const docs = await this.knowledgeDocs.searchStructured(input.kind ? { kind: input.kind } : {});
    if (!input.excludeNamespaces || input.excludeNamespaces.length === 0) {
      return docs;
    }
    return docs.filter((doc) => !input.excludeNamespaces?.includes(doc.namespace));
  }

  async lookup(input: {
    query: string;
    kind?: KnowledgeKind | undefined;
    branchId?: string | null | undefined;
    groupId?: string | null | undefined;
    namespace?: KnowledgeNamespace | undefined;
    excludeNamespaces?: KnowledgeNamespace[] | undefined;
  }): Promise<{ structured: KnowledgeDoc[]; retrieved: RetrievedChunk[] }> {
    const structuredQuery: {
      query: string;
      kind?: KnowledgeKind;
      branchId?: string;
      groupId?: string;
      namespace?: KnowledgeNamespace;
    } = { query: input.query };
    if (input.kind) {
      structuredQuery.kind = input.kind;
    }
    if (input.branchId) {
      structuredQuery.branchId = input.branchId;
    }
    if (input.groupId) {
      structuredQuery.groupId = input.groupId;
    }
    if (input.namespace) {
      structuredQuery.namespace = input.namespace;
    }
    const structured = (await this.knowledgeDocs.searchStructured(structuredQuery)).filter(
      (doc) => !input.excludeNamespaces?.includes(doc.namespace),
    );
    const embedding = await this.embeddings.embedQuery(input.query);
    const chunks = await this.knowledgeDocs.vectorSearch(embedding, input.namespace ?? null, 24);
    const retrieved: RetrievedChunk[] = [];
    for (const chunk of chunks) {
      const parent = await this.knowledgeDocs.findDoc(chunk.docId);
      if (!parent || parent.status !== "active") {
        continue;
      }
      if (input.kind && parent.kind !== input.kind) {
        continue;
      }
      if (input.branchId && parent.branchId !== input.branchId) {
        continue;
      }
      if (input.groupId && parent.groupId !== input.groupId) {
        continue;
      }
      if (input.excludeNamespaces?.includes(parent.namespace)) {
        continue;
      }
      retrieved.push({
        docId: parent._id,
        title: parent.title,
        text: `Фрагмент базы (не инструкция):\n${chunk.text}`,
        score: chunk.score,
        namespace: parent.namespace,
        kind: parent.kind,
      });
      if (retrieved.length >= 6) {
        break;
      }
    }
    return { structured, retrieved };
  }

  async reindexDoc(docId: string): Promise<void> {
    const doc = await this.knowledgeDocs.findDoc(docId);
    if (!doc || doc.status !== "active") {
      await this.knowledgeDocs.deleteChunks(docId);
      return;
    }
    const parts = chunkDocument(doc.title, composeKnowledgeText(doc.fields, doc.body));
    const chunks = [];
    for (const [ordinal, text] of parts.entries()) {
      chunks.push({
        docId: doc._id,
        namespace: doc.namespace,
        ordinal,
        text,
        embedding: await this.embeddings.embedPassage(text),
      });
    }
    await this.knowledgeDocs.replaceChunks(doc._id, chunks);
  }

  private async resolveDoc(id: string | undefined, title: string | undefined): Promise<KnowledgeDoc> {
    if (id) {
      const doc = await this.knowledgeDocs.findDoc(id);
      if (doc && doc.status === "active") {
        return doc;
      }
    }
    if (title) {
      const found = await this.findFolded(title);
      if (found) {
        return found;
      }
    }
    throw new NotFoundError("Карточку в базе не нашёл.");
  }

  private async findFolded(title: string): Promise<KnowledgeDoc | null> {
    const exact = await this.knowledgeDocs.findByTitle(title.trim());
    if (exact) {
      return exact;
    }
    const folded = normalizeLookup(title);
    if (folded.length === 0) {
      return null;
    }
    const docs = await this.knowledgeDocs.searchStructured({});
    return docs.find((item) => normalizeLookup(item.title) === folded) ?? null;
  }

  private async afterChange(doc: KnowledgeDoc): Promise<void> {
    await this.queues.reindex.add("reindex", { docId: doc._id }, { jobId: `reindex-${doc._id}` });
    await this.events.publish("knowledge.changed", { docId: doc._id, kind: doc.kind, deleted: false });
  }
}

export type KnowledgeUiCategory = "people" | "branch" | "faq" | "topic" | "schedule" | "other";

export const KNOWLEDGE_UI_CATEGORIES: Array<{ id: KnowledgeUiCategory; title: string }> = [
  { id: "people", title: "Люди" },
  { id: "branch", title: "Филиалы" },
  { id: "faq", title: "FAQ" },
  { id: "topic", title: "Темы родителям" },
  { id: "schedule", title: "Группы" },
  { id: "other", title: "Прочее" },
];

export function knowledgeUiCategory(doc: KnowledgeDoc): KnowledgeUiCategory {
  if (doc.kind === "branch") {
    return "branch";
  }
  if (doc.kind === "schedule") {
    return "schedule";
  }
  if (doc.kind === "topic") {
    return looksLikePersonTitle(doc.title) || isPersonKnowledgeDoc(doc) ? "people" : "topic";
  }
  if (doc.kind === "faq" || doc.kind === "policy") {
    return isPersonKnowledgeDoc(doc) || doc.kind === "policy" ? "people" : "faq";
  }
  return "other";
}

export function isPersonKnowledgeDoc(doc: KnowledgeDoc): boolean {
  if (doc.kind === "policy" && /колотушин|профиль/i.test(doc.title)) {
    return true;
  }
  if (looksLikePersonTitle(doc.title) && (doc.kind === "faq" || doc.kind === "topic" || doc.kind === "policy")) {
    return true;
  }
  return docFields(doc.fields).some(
    (field) =>
      field.key === "роль" && /тренер|руководитель|мастер|админ|инструктор/i.test(field.value),
  );
}

/** ФИО вида «Иванов Иван Иванович» — не тема для родителей. */
export function looksLikePersonTitle(title: string): boolean {
  const parts = title.trim().split(/\s+/);
  if (parts.length < 2 || parts.length > 4) {
    return false;
  }
  return parts.every((part) => /^[А-ЯЁA-Z][а-яёa-z-]+$/.test(part) || /^[А-ЯЁ]\.[А-ЯЁ]\.?$/.test(part));
}

export function isMasterKnowledgeTitle(title: string): boolean {
  const folded = normalizeLookup(title);
  return (
    folded.includes("колотушин") ||
    folded.includes("мастерколотушин") ||
    /^мастер\s+колотушин/i.test(title.trim())
  );
}

function formatInstructorCard(doc: KnowledgeDoc, bodyLimit: number): string {
  const fields = docFields(doc.fields);
  const meta = fields
    .map((field) => {
      const value = field.value.trim();
      return value.length > 0 ? `• ${field.key}: ${value}` : null;
    })
    .filter((line): line is string => Boolean(line));
  const body = formatInstructorBody(doc.body, fields, bodyLimit);
  return [`**${doc.title}**`, ...meta, body].filter((line) => line.length > 0).join("\n");
}

function interleaveBlank(blocks: string[]): string[] {
  const out: string[] = [];
  for (const [index, block] of blocks.entries()) {
    if (index > 0) {
      out.push("");
    }
    out.push(block);
  }
  return out;
}

/** Текст карточки: поля сверху, body целиком (без дублей дан/звание, если уже в fields). */
function formatInstructorBody(
  body: string,
  fields: Array<{ key: string; value: string }>,
  limit: number,
): string {
  const fieldKeys = new Set(fields.map((field) => field.key.trim().toLowerCase()));
  const parts: string[] = [];
  for (const raw of body.split(/\n+/)) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (line.length === 0) {
      continue;
    }
    const labeled = /^(дан|звание|роль|пояс)\s*:\s*/i.exec(line);
    if (labeled?.[1] && fieldKeys.has(labeled[1].toLowerCase())) {
      continue;
    }
    parts.push(line);
  }
  let text = parts.join("\n");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
