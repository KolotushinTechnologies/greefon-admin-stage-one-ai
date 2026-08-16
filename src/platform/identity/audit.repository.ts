import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";

export type AuditEvent = {
  _id: string;
  actorTelegramId: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: Date;
};

export class AuditRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<AuditEvent> {
    return this.mongo.getDb().collection("audit_events");
  }

  async record(actorTelegramId: string, action: string, details: Record<string, unknown>): Promise<void> {
    await this.col().insertOne({
      _id: new ObjectId().toHexString(),
      actorTelegramId,
      action,
      details,
      createdAt: new Date(),
    });
  }
}
