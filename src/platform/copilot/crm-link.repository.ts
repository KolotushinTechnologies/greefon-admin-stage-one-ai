import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";

export type CrmLink = {
  _id: string;
  parentTelegramId: string;
  parentUsername: string | null;
  parentDisplayName: string | null;
  phone: string | null;
  studentCrmId: string | null;
  studentName: string | null;
  guardianCrmId: string | null;
  guardianName: string | null;
  linkedByTelegramId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Жёсткая связка Telegram родителя ↔ CRM. */
export class CrmLinkRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<CrmLink> {
    return this.mongo.getDb().collection("crm_telegram_links");
  }

  async findByTelegram(parentTelegramId: string): Promise<CrmLink | null> {
    return this.col().findOne({ parentTelegramId });
  }

  async findByStudentCrmId(studentCrmId: string): Promise<CrmLink | null> {
    return this.col().findOne({ studentCrmId });
  }

  async upsert(input: {
    parentTelegramId: string;
    parentUsername?: string | null;
    parentDisplayName?: string | null;
    phone?: string | null;
    studentCrmId?: string | null;
    studentName?: string | null;
    guardianCrmId?: string | null;
    guardianName?: string | null;
    linkedByTelegramId?: string | null;
  }): Promise<CrmLink> {
    const now = new Date();
    const existing = await this.findByTelegram(input.parentTelegramId);
    const doc: CrmLink = {
      _id: existing?._id ?? new ObjectId().toHexString(),
      parentTelegramId: input.parentTelegramId,
      parentUsername: input.parentUsername ?? existing?.parentUsername ?? null,
      parentDisplayName: input.parentDisplayName ?? existing?.parentDisplayName ?? null,
      phone: input.phone ?? existing?.phone ?? null,
      studentCrmId: input.studentCrmId ?? existing?.studentCrmId ?? null,
      studentName: input.studentName ?? existing?.studentName ?? null,
      guardianCrmId: input.guardianCrmId ?? existing?.guardianCrmId ?? null,
      guardianName: input.guardianName ?? existing?.guardianName ?? null,
      linkedByTelegramId: input.linkedByTelegramId ?? existing?.linkedByTelegramId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.col().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return doc;
  }
}
