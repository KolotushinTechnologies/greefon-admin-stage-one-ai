import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";

export type CrmFunnelEvent = {
  _id: string;
  studentCrmId: string;
  studentName: string;
  fromStatus: string | null;
  toStatus: string;
  at: Date;
};

/** Переходы статусов CRM — для честного дневного отчёта. */
export class CrmFunnelRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<CrmFunnelEvent> {
    return this.mongo.getDb().collection("crm_funnel_events");
  }

  async recordTransition(input: {
    studentCrmId: string;
    studentName: string;
    fromStatus: string | null;
    toStatus: string;
  }): Promise<void> {
    if (input.fromStatus === input.toStatus) {
      return;
    }
    await this.col().insertOne({
      _id: new ObjectId().toHexString(),
      studentCrmId: input.studentCrmId,
      studentName: input.studentName,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      at: new Date(),
    });
  }

  async countToStatusSince(from: Date, statuses: string[]): Promise<number> {
    return this.col().countDocuments({
      at: { $gte: from },
      toStatus: { $in: statuses },
    });
  }
}
