import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";

export type AiActionLog = {
  _id: string;
  kind: string;
  actor: "ai" | "staff" | "system";
  actorTelegramId: string | null;
  escalationId: string | null;
  parentTelegramId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

/** Лог действий AI/штаба — для метрик через 2–3 месяца. */
export class AiActionLogRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<AiActionLog> {
    return this.mongo.getDb().collection("ai_action_logs");
  }

  async record(input: {
    kind: string;
    actor?: "ai" | "staff" | "system";
    actorTelegramId?: string | null;
    escalationId?: string | null;
    parentTelegramId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.col().insertOne({
      _id: new ObjectId().toHexString(),
      kind: input.kind,
      actor: input.actor ?? "ai",
      actorTelegramId: input.actorTelegramId ?? null,
      escalationId: input.escalationId ?? null,
      parentTelegramId: input.parentTelegramId ?? null,
      payload: input.payload ?? {},
      createdAt: new Date(),
    });
  }
}
