import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import type { SchoolEvent, SchoolEventKind, SchoolEventStatus } from "./types.js";

export class SchoolEventRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<SchoolEvent> {
    return this.mongo.getDb().collection("school_events");
  }

  async insert(input: Omit<SchoolEvent, "_id" | "createdAt" | "updatedAt">): Promise<SchoolEvent> {
    const now = new Date();
    const doc: SchoolEvent = {
      ...input,
      _id: new ObjectId().toHexString(),
      createdAt: now,
      updatedAt: now,
    };
    await this.col().insertOne(doc);
    return doc;
  }

  async update(id: string, patch: Partial<Omit<SchoolEvent, "_id" | "createdAt">>): Promise<SchoolEvent | null> {
    await this.col().updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } });
    return this.findById(id);
  }

  async findById(id: string): Promise<SchoolEvent | null> {
    return this.col().findOne({ _id: id });
  }

  async list(filter: { kind?: SchoolEventKind; status?: SchoolEventStatus } = {}): Promise<SchoolEvent[]> {
    const query: Record<string, unknown> = {};
    if (filter.kind) {
      query.kind = filter.kind;
    }
    if (filter.status) {
      query.status = filter.status;
    }
    return this.col().find(query).sort({ updatedAt: -1 }).limit(50).toArray();
  }
}
