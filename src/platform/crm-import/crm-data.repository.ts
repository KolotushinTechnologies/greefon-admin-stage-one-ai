import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import type {
  CrmCatalogEvent,
  CrmCatalogEventKind,
  CrmGuardian,
  CrmPaymentRecord,
  CrmScheduleSession,
  CrmStudent,
  CrmVisitMark,
} from "./types.js";

export class CrmPeopleRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private students(): Collection<CrmStudent> {
    return this.mongo.getDb().collection("crm_students");
  }

  private guardians(): Collection<CrmGuardian> {
    return this.mongo.getDb().collection("crm_guardians");
  }

  async upsertGuardian(input: Omit<CrmGuardian, "_id" | "createdAt" | "updatedAt">): Promise<CrmGuardian> {
    const now = new Date();
    const existing = await this.guardians().findOne({ crmId: input.crmId });
    const doc: CrmGuardian = {
      _id: existing?._id ?? new ObjectId().toHexString(),
      crmId: input.crmId,
      name: input.name,
      phone: input.phone,
      email: input.email,
      addName: input.addName,
      addPhone: input.addPhone,
      createTs: input.createTs,
      syncedAt: input.syncedAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.guardians().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return doc;
  }

  async upsertGuardians(inputs: Array<Omit<CrmGuardian, "_id" | "createdAt" | "updatedAt">>): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const now = new Date();
    const existing = await this.guardians()
      .find({ crmId: { $in: inputs.map((item) => item.crmId) } })
      .project({ _id: 1, crmId: 1, createdAt: 1 })
      .toArray();
    const byCrm = new Map(existing.map((row) => [row.crmId, row]));
    const ops = inputs.map((input) => {
      const prev = byCrm.get(input.crmId);
      const doc: CrmGuardian = {
        _id: prev?._id ?? new ObjectId().toHexString(),
        ...input,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      };
      return {
        replaceOne: {
          filter: { _id: doc._id },
          replacement: doc,
          upsert: true,
        },
      };
    });
    const result = await this.guardians().bulkWrite(ops, { ordered: false });
    return result.upsertedCount + result.modifiedCount + result.matchedCount;
  }

  async upsertStudent(input: Omit<CrmStudent, "_id" | "createdAt" | "updatedAt">): Promise<CrmStudent> {
    const now = new Date();
    const existing = await this.students().findOne({ crmId: input.crmId });
    const doc: CrmStudent = {
      ...input,
      _id: existing?._id ?? new ObjectId().toHexString(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.students().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return doc;
  }

  async upsertStudents(inputs: Array<Omit<CrmStudent, "_id" | "createdAt" | "updatedAt">>): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const now = new Date();
    const existing = await this.students()
      .find({ crmId: { $in: inputs.map((item) => item.crmId) } })
      .project({ _id: 1, crmId: 1, createdAt: 1, status: 1, name: 1 })
      .toArray();
    const byCrm = new Map(existing.map((row) => [row.crmId, row]));
    const funnelDocs: Array<{
      _id: string;
      studentCrmId: string;
      studentName: string;
      fromStatus: string | null;
      toStatus: string;
      at: Date;
    }> = [];
    const ops = inputs.map((input) => {
      const prev = byCrm.get(input.crmId);
      const prevStatus = prev && "status" in prev ? String((prev as { status?: string }).status ?? "") : null;
      if (prev && prevStatus !== null && prevStatus !== input.status) {
        funnelDocs.push({
          _id: new ObjectId().toHexString(),
          studentCrmId: input.crmId,
          studentName: input.name,
          fromStatus: prevStatus || null,
          toStatus: input.status,
          at: now,
        });
      }
      const doc: CrmStudent = {
        ...input,
        _id: prev?._id ?? new ObjectId().toHexString(),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      };
      return {
        replaceOne: {
          filter: { _id: doc._id },
          replacement: doc,
          upsert: true,
        },
      };
    });
    const result = await this.students().bulkWrite(ops, { ordered: false });
    if (funnelDocs.length > 0) {
      await this.mongo
        .getDb()
        .collection("crm_funnel_events")
        .insertMany(funnelDocs as Array<Record<string, unknown>>, { ordered: false })
        .catch(() => undefined);
    }
    return result.upsertedCount + result.modifiedCount + result.matchedCount;
  }

  async countStudents(): Promise<number> {
    return this.students().countDocuments();
  }

  async countGuardians(): Promise<number> {
    return this.guardians().countDocuments();
  }

  /** Студенты, обновлённые/созданные в окне (по syncedAt/updatedAt). */
  async countStudentsTouchedSince(from: Date, statuses?: string[]): Promise<number> {
    const query: Record<string, unknown> = {
      $or: [{ syncedAt: { $gte: from } }, { updatedAt: { $gte: from } }, { createdAt: { $gte: from } }],
    };
    if (statuses && statuses.length > 0) {
      query.status = { $in: statuses };
    }
    return this.students().countDocuments(query);
  }

  async listByStatus(statuses: string[], limit = 20): Promise<CrmStudent[]> {
    return this.students()
      .find({ status: { $in: statuses } })
      .sort({ updatedAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 40))
      .toArray();
  }

  /** Пробные (sampler), давно без обновления — «были на пробном, покупки нет». */
  async listStaleSamplers(olderThanDays: number, limit = 12): Promise<CrmStudent[]> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    return this.students()
      .find({ status: "sampler", updatedAt: { $lte: cutoff } })
      .sort({ updatedAt: 1 })
      .limit(Math.min(Math.max(limit, 1), 30))
      .toArray();
  }

  async findStudentByPhone(phoneDigits: string): Promise<CrmStudent | null> {
    if (phoneDigits.length < 10) {
      return null;
    }
    const tail = phoneDigits.slice(-10);
    return this.students().findOne({
      $or: [
        { accountPhone: { $regex: tail } },
        { accountAddPhone: { $regex: tail } },
      ],
    });
  }

  async findGuardianByPhone(phoneDigits: string): Promise<CrmGuardian | null> {
    if (phoneDigits.length < 10) {
      return null;
    }
    const tail = phoneDigits.slice(-10);
    return this.guardians().findOne({
      $or: [{ phone: { $regex: tail } }, { addPhone: { $regex: tail } }],
    });
  }
}

export class CrmOpsRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private payments(): Collection<CrmPaymentRecord> {
    return this.mongo.getDb().collection("crm_payments");
  }

  private sessions(): Collection<CrmScheduleSession> {
    return this.mongo.getDb().collection("crm_schedule_sessions");
  }

  private visits(): Collection<CrmVisitMark> {
    return this.mongo.getDb().collection("crm_visit_marks");
  }

  private catalog(): Collection<CrmCatalogEvent> {
    return this.mongo.getDb().collection("crm_catalog_events");
  }

  async upsertPayment(input: Omit<CrmPaymentRecord, "_id" | "createdAt" | "updatedAt">): Promise<CrmPaymentRecord> {
    const now = new Date();
    const existing = await this.payments().findOne({ crmId: input.crmId });
    const doc: CrmPaymentRecord = {
      ...input,
      _id: existing?._id ?? new ObjectId().toHexString(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.payments().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return doc;
  }

  async upsertPayments(inputs: Array<Omit<CrmPaymentRecord, "_id" | "createdAt" | "updatedAt">>): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const now = new Date();
    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < inputs.length; i += chunkSize) {
      const chunk = inputs.slice(i, i + chunkSize);
      const existing = await this.payments()
        .find({ crmId: { $in: chunk.map((item) => item.crmId) } })
        .project({ _id: 1, crmId: 1, createdAt: 1 })
        .toArray();
      const byCrm = new Map(existing.map((row) => [row.crmId, row]));
      const ops = chunk.map((input) => {
        const prev = byCrm.get(input.crmId);
        const doc: CrmPaymentRecord = {
          ...input,
          _id: prev?._id ?? new ObjectId().toHexString(),
          createdAt: prev?.createdAt ?? now,
          updatedAt: now,
        };
        return {
          replaceOne: {
            filter: { _id: doc._id },
            replacement: doc,
            upsert: true,
          },
        };
      });
      const result = await this.payments().bulkWrite(ops, { ordered: false });
      written += result.upsertedCount + result.modifiedCount + result.matchedCount;
    }
    return written;
  }

  async upsertVisitMarks(inputs: Array<Omit<CrmVisitMark, "_id" | "createdAt" | "updatedAt">>): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const now = new Date();
    const ops = inputs.map((input) => {
      const doc: CrmVisitMark = {
        ...input,
        _id: new ObjectId().toHexString(),
        createdAt: now,
        updatedAt: now,
      };
      return {
        updateOne: {
          filter: {
            groupCrmId: input.groupCrmId,
            clientCrmId: input.clientCrmId,
            scheduleCrmId: input.scheduleCrmId,
          },
          update: {
            $set: {
              value: input.value,
              clientName: input.clientName,
              clientStatus: input.clientStatus,
              syncedAt: input.syncedAt,
              updatedAt: now,
            },
            $setOnInsert: {
              _id: doc._id,
              groupCrmId: input.groupCrmId,
              clientCrmId: input.clientCrmId,
              scheduleCrmId: input.scheduleCrmId,
              createdAt: now,
            },
          },
          upsert: true,
        },
      };
    });
    const result = await this.visits().bulkWrite(ops, { ordered: false });
    return result.upsertedCount + result.modifiedCount + result.matchedCount;
  }

  async upsertScheduleSessions(
    inputs: Array<Omit<CrmScheduleSession, "_id" | "createdAt" | "updatedAt">>,
  ): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const now = new Date();
    const existing = await this.sessions()
      .find({ crmId: { $in: inputs.map((item) => item.crmId) } })
      .project({ _id: 1, crmId: 1, createdAt: 1 })
      .toArray();
    const byCrm = new Map(existing.map((row) => [row.crmId, row]));
    const ops = inputs.map((input) => {
      const prev = byCrm.get(input.crmId);
      const doc: CrmScheduleSession = {
        ...input,
        _id: prev?._id ?? new ObjectId().toHexString(),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      };
      return {
        replaceOne: {
          filter: { _id: doc._id },
          replacement: doc,
          upsert: true,
        },
      };
    });
    const result = await this.sessions().bulkWrite(ops, { ordered: false });
    return result.upsertedCount + result.modifiedCount + result.matchedCount;
  }

  async upsertCatalogEvents(inputs: Array<Omit<CrmCatalogEvent, "_id" | "createdAt" | "updatedAt">>): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const now = new Date();
    const ops = inputs.map((input) => {
      const doc: CrmCatalogEvent = {
        ...input,
        _id: new ObjectId().toHexString(),
        createdAt: now,
        updatedAt: now,
      };
      return {
        updateOne: {
          filter: { kind: input.kind, crmId: input.crmId },
          update: {
            $set: {
              name: input.name,
              dateStart: input.dateStart,
              dateEnd: input.dateEnd,
              comment: input.comment,
              creatorCrmId: input.creatorCrmId,
              padawans: input.padawans,
              syncedAt: input.syncedAt,
              updatedAt: now,
            },
            $setOnInsert: {
              _id: doc._id,
              kind: input.kind,
              crmId: input.crmId,
              createdAt: now,
            },
          },
          upsert: true,
        },
      };
    });
    const result = await this.catalog().bulkWrite(ops, { ordered: false });
    return result.upsertedCount + result.modifiedCount + result.matchedCount;
  }

  async upsertScheduleSession(
    input: Omit<CrmScheduleSession, "_id" | "createdAt" | "updatedAt">,
  ): Promise<CrmScheduleSession> {
    const now = new Date();
    const existing = await this.sessions().findOne({ crmId: input.crmId });
    const doc: CrmScheduleSession = {
      ...input,
      _id: existing?._id ?? new ObjectId().toHexString(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.sessions().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return doc;
  }

  async upsertVisitMark(input: Omit<CrmVisitMark, "_id" | "createdAt" | "updatedAt">): Promise<CrmVisitMark> {
    const now = new Date();
    const existing = await this.visits().findOne({
      groupCrmId: input.groupCrmId,
      clientCrmId: input.clientCrmId,
      scheduleCrmId: input.scheduleCrmId,
    });
    const doc: CrmVisitMark = {
      ...input,
      _id: existing?._id ?? new ObjectId().toHexString(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.visits().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return doc;
  }

  async upsertCatalogEvent(input: Omit<CrmCatalogEvent, "_id" | "createdAt" | "updatedAt">): Promise<CrmCatalogEvent> {
    const now = new Date();
    const existing = await this.catalog().findOne({ kind: input.kind, crmId: input.crmId });
    const doc: CrmCatalogEvent = {
      ...input,
      _id: existing?._id ?? new ObjectId().toHexString(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.catalog().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return doc;
  }

  async countPayments(purposePrefix?: "training" | "online"): Promise<number> {
    if (!purposePrefix) {
      return this.payments().countDocuments();
    }
    if (purposePrefix === "training") {
      return this.payments().countDocuments({ purpose: "training" });
    }
    return this.payments().countDocuments({ purpose: { $in: ["online", "online_training"] } });
  }

  async sumPaidSince(from: Date): Promise<{ count: number; amountKopecks: number }> {
    const rows = await this.payments()
      .find({
        paid: true,
        $or: [{ syncedAt: { $gte: from } }, { updatedAt: { $gte: from } }, { createdAt: { $gte: from } }],
      })
      .project({ amountKopecks: 1 })
      .toArray();
    const amountKopecks = rows.reduce((sum, row) => sum + (Number(row.amountKopecks) || 0), 0);
    return { count: rows.length, amountKopecks };
  }

  /** Неоплаченные счета / долги из CRM. */
  async listUnpaid(limit = 20): Promise<CrmPaymentRecord[]> {
    return this.payments()
      .find({ paid: false, amountKopecks: { $gt: 0 } })
      .sort({ updatedAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 40))
      .toArray();
  }

  async countUnpaid(): Promise<number> {
    return this.payments().countDocuments({ paid: false, amountKopecks: { $gt: 0 } });
  }

  async findLatestPaymentForClient(clientCrmId: string): Promise<CrmPaymentRecord | null> {
    return this.payments().findOne({ clientCrmId }, { sort: { updatedAt: -1 } });
  }

  async countVisitMarksSince(from: Date): Promise<number> {
    return this.visits().countDocuments({
      $or: [{ syncedAt: { $gte: from } }, { updatedAt: { $gte: from } }, { createdAt: { $gte: from } }],
      value: { $nin: ["", "0", "false", "null"] },
    });
  }

  async countSessions(): Promise<number> {
    return this.sessions().countDocuments();
  }

  async countVisitMarks(): Promise<number> {
    return this.visits().countDocuments();
  }

  async countCatalog(kind: CrmCatalogEventKind): Promise<number> {
    return this.catalog().countDocuments({ kind });
  }

  async saveImportReport(report: import("./types.js").CrmImportReport): Promise<void> {
    await this.mongo.getDb().collection("crm_import_reports").insertOne({
      ...report,
      createdAt: new Date(),
    });
  }
}
