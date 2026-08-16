import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import { KNOWLEDGE_VECTOR_INDEX } from "../../infrastructure/mongo/indexes.js";
import { normalizeLookup } from "../org/text-match.js";
import type { KnowledgeChunk, KnowledgeDoc, KnowledgeKind, KnowledgeNamespace } from "./types.js";

export class KnowledgeRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private docs(): Collection<KnowledgeDoc> {
    return this.mongo.getDb().collection("knowledge_docs");
  }

  private chunks(): Collection<KnowledgeChunk> {
    return this.mongo.getDb().collection("knowledge_chunks");
  }

  async insertDoc(input: Omit<KnowledgeDoc, "_id" | "createdAt" | "updatedAt">): Promise<KnowledgeDoc> {
    const now = new Date();
    const doc: KnowledgeDoc = {
      ...input,
      fields: input.fields ?? [],
      _id: new ObjectId().toHexString(),
      createdAt: now,
      updatedAt: now,
    };
    await this.docs().insertOne(doc);
    return doc;
  }

  async updateDoc(
    id: string,
    patch: Partial<
      Pick<KnowledgeDoc, "title" | "body" | "fields" | "namespace" | "kind" | "branchId" | "groupId" | "status" | "updatedByTelegramId">
    >,
  ): Promise<KnowledgeDoc | null> {
    await this.docs().updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } });
    return this.docs().findOne({ _id: id });
  }

  async findDoc(id: string): Promise<KnowledgeDoc | null> {
    return this.docs().findOne({ _id: id });
  }

  async findByTitle(title: string): Promise<KnowledgeDoc | null> {
    return this.docs().findOne({ title, status: "active" });
  }

  async findByBranchId(branchId: string): Promise<KnowledgeDoc | null> {
    return this.docs().findOne({ branchId, status: "active", kind: "branch" });
  }

  async searchStructured(filter: {
    query?: string;
    kind?: KnowledgeKind;
    branchId?: string;
    groupId?: string;
    namespace?: KnowledgeNamespace;
  }): Promise<KnowledgeDoc[]> {
    const query: Record<string, unknown> = { status: "active" };
    if (filter.kind) {
      query.kind = filter.kind;
    }
    if (filter.branchId) {
      query.branchId = filter.branchId;
    }
    if (filter.groupId) {
      query.groupId = filter.groupId;
    }
    if (filter.namespace) {
      query.namespace = filter.namespace;
    }
    if (filter.query) {
      const patterns = searchPatterns(filter.query);
      query.$or = patterns.flatMap((pattern) => [
        { title: { $regex: pattern, $options: "i" } },
        { body: { $regex: pattern, $options: "i" } },
        { "fields.key": { $regex: pattern, $options: "i" } },
        { "fields.value": { $regex: pattern, $options: "i" } },
      ]);
    }
    return this.docs().find(query).sort({ updatedAt: -1 }).limit(filter.query ? 20 : 200).toArray();
  }

  async replaceChunks(docId: string, chunks: Array<Omit<KnowledgeChunk, "_id" | "createdAt">>): Promise<void> {
    await this.chunks().deleteMany({ docId });
    if (chunks.length === 0) {
      return;
    }
    const now = new Date();
    await this.chunks().insertMany(
      chunks.map((chunk) => ({
        ...chunk,
        _id: new ObjectId().toHexString(),
        createdAt: now,
      })),
    );
  }

  async deleteChunks(docId: string): Promise<void> {
    await this.chunks().deleteMany({ docId });
  }

  async vectorSearch(embedding: number[], namespace: KnowledgeNamespace | null, limit: number): Promise<Array<KnowledgeChunk & { score: number }>> {
    try {
      const filter = namespace ? { namespace } : {};
      const rows = await this.chunks()
        .aggregate<KnowledgeChunk & { score: number }>([
          {
            $vectorSearch: {
              index: KNOWLEDGE_VECTOR_INDEX,
              path: "embedding",
              queryVector: embedding,
              numCandidates: Math.max(limit * 20, 40),
              limit,
              filter,
            },
          },
          { $addFields: { score: { $meta: "vectorSearchScore" } } },
        ])
        .toArray();
      if (rows.length > 0) {
        return rows;
      }
    } catch {
      // индекс ещё не готов — ищем косинусом по тому, что уже лежит
    }
    return this.cosineFallback(embedding, namespace, limit);
  }

  async listChunks(namespace: KnowledgeNamespace | null, limit = 400): Promise<KnowledgeChunk[]> {
    const filter = namespace ? { namespace } : {};
    return this.chunks().find(filter).limit(limit).toArray();
  }

  private async cosineFallback(
    embedding: number[],
    namespace: KnowledgeNamespace | null,
    limit: number,
  ): Promise<Array<KnowledgeChunk & { score: number }>> {
    const chunks = await this.listChunks(namespace);
    return chunks
      .map((chunk) => ({ ...chunk, score: cosine(embedding, chunk.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

const SEARCH_STOP = new Set([
  "как",
  "что",
  "это",
  "для",
  "или",
  "где",
  "куда",
  "можно",
  "надо",
  "есть",
  "нет",
  "наш",
  "нам",
  "вас",
  "вам",
  "доехать",
  "проехать",
  "найти",
  "зал",
  "филиал",
  "адрес",
  "метро",
  "пожалуйста",
  "подскажи",
  "скажи",
  "хочу",
  "узнать",
]);

function searchPatterns(raw: string): string[] {
  const tokens = normalizeLookup(raw)
    .split(" ")
    .filter((token) => token.length >= 4 && !SEARCH_STOP.has(token));
  const unique = [...new Set(tokens)];
  if (unique.length === 0) {
    const folded = normalizeLookup(raw);
    return folded.length > 0 ? [escapeRegex(folded)] : [escapeRegex(raw)];
  }
  return unique.map((token) => escapeRegex(token));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
