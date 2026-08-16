import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import type { Escalation, EscalationStatus } from "./types.js";

export class EscalationRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<Escalation> {
    return this.mongo.getDb().collection("escalations");
  }

  async insert(input: Omit<Escalation, "_id" | "createdAt" | "updatedAt">): Promise<Escalation> {
    const now = new Date();
    const doc: Escalation = {
      ...input,
      _id: new ObjectId().toHexString(),
      createdAt: now,
      updatedAt: now,
    };
    await this.col().insertOne(doc);
    return doc;
  }

  async findById(id: string): Promise<Escalation | null> {
    return this.col().findOne({ _id: id });
  }

  async update(id: string, patch: Partial<Omit<Escalation, "_id" | "createdAt">>): Promise<Escalation | null> {
    await this.col().updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } });
    return this.findById(id);
  }

  async countOpen(): Promise<number> {
    return this.col().countDocuments({ status: { $in: ["open", "claimed"] } });
  }

  async countSince(from: Date, status?: EscalationStatus): Promise<number> {
    const query: Record<string, unknown> = { createdAt: { $gte: from } };
    if (status) {
      query.status = status;
    }
    return this.col().countDocuments(query);
  }

  async listRecentUnknown(from: Date, limit = 8): Promise<Escalation[]> {
    return this.col().find({ createdAt: { $gte: from } }).sort({ createdAt: -1 }).limit(limit).toArray();
  }
}
