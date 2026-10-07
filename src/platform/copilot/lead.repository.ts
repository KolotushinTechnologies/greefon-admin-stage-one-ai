import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import type { InboundIntent, LeadCard, LeadHeat } from "./types.js";

export type LeadRecord = {
  _id: string;
  parentTelegramId: string;
  parentUsername: string | null;
  parentDisplayName: string | null;
  escalationId: string | null;
  intent: InboundIntent | string;
  heat: LeadHeat | string;
  heatWhy: string;
  stageLabel: string;
  nextSalesStep: string;
  lead: LeadCard;
  question: string;
  status: "open" | "won" | "lost" | "archived";
  createdAt: Date;
  updatedAt: Date;
};

export class LeadRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<LeadRecord> {
    return this.mongo.getDb().collection("copilot_leads");
  }

  async upsertFromEscalation(input: {
    parentTelegramId: string;
    parentUsername: string | null;
    parentDisplayName: string | null;
    escalationId: string;
    intent: string;
    heat: string;
    heatWhy: string;
    stageLabel: string;
    nextSalesStep: string;
    lead: LeadCard;
    question: string;
  }): Promise<LeadRecord> {
    const now = new Date();
    const existing = await this.col().findOne({ escalationId: input.escalationId });
    const doc: LeadRecord = {
      _id: existing?._id ?? new ObjectId().toHexString(),
      parentTelegramId: input.parentTelegramId,
      parentUsername: input.parentUsername,
      parentDisplayName: input.parentDisplayName,
      escalationId: input.escalationId,
      intent: input.intent,
      heat: input.heat,
      heatWhy: input.heatWhy,
      stageLabel: input.stageLabel,
      nextSalesStep: input.nextSalesStep,
      lead: input.lead,
      question: input.question,
      status: existing?.status ?? "open",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.col().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return doc;
  }

  async listOpen(limit = 30): Promise<LeadRecord[]> {
    const heatRank: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
    const rows = await this.col()
      .find({ status: "open" })
      .sort({ updatedAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 60))
      .toArray();
    return rows.sort((a, b) => {
      const ha = heatRank[String(a.heat)] ?? 9;
      const hb = heatRank[String(b.heat)] ?? 9;
      if (ha !== hb) return ha - hb;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  }

  async findByParent(parentTelegramId: string): Promise<LeadRecord | null> {
    return this.col().findOne({ parentTelegramId, status: "open" }, { sort: { updatedAt: -1 } });
  }
}
