import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import type { Branch, Instructor, TrainingGroup, Weekday } from "./types.js";

export class OrgRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private branches(): Collection<Branch> {
    return this.mongo.getDb().collection("branches");
  }

  private instructors(): Collection<Instructor> {
    return this.mongo.getDb().collection("instructors");
  }

  private groups(): Collection<TrainingGroup> {
    return this.mongo.getDb().collection("groups");
  }

  async upsertBranch(input: Omit<Branch, "_id" | "createdAt" | "updatedAt"> & { _id?: string }): Promise<Branch> {
    const now = new Date();
    const existing = await this.branches().findOne({ crmId: input.crmId });
    const _id = existing?._id ?? input._id ?? new ObjectId().toHexString();
    const aliases = [...new Set([...(existing?.aliases ?? []), ...input.aliases])];
    const doc: Branch = {
      _id,
      crmId: input.crmId,
      name: input.name,
      status: input.status,
      aliases,
      comment: input.comment,
      syncedAt: input.syncedAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.branches().replaceOne({ _id }, doc, { upsert: true });
    return doc;
  }

  async upsertInstructor(input: Omit<Instructor, "_id" | "createdAt" | "updatedAt">): Promise<Instructor> {
    const now = new Date();
    const existing = await this.instructors().findOne({ crmId: input.crmId });
    const doc: Instructor = {
      _id: existing?._id ?? new ObjectId().toHexString(),
      crmId: input.crmId,
      name: input.name,
      comment: input.comment,
      syncedAt: input.syncedAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.instructors().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return doc;
  }

  async upsertGroup(input: Omit<TrainingGroup, "_id" | "createdAt" | "updatedAt" | "localOverride">): Promise<TrainingGroup> {
    const now = new Date();
    const existing = await this.groups().findOne({ crmId: input.crmId });
    const doc: TrainingGroup = {
      _id: existing?._id ?? new ObjectId().toHexString(),
      crmId: input.crmId,
      branchId: input.branchId,
      instructorId: input.instructorId,
      name: input.name,
      timeNote: input.timeNote,
      weekdays: input.weekdays,
      potential: input.potential,
      comment: input.comment,
      syncedAt: input.syncedAt,
      localOverride: existing?.localOverride ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.groups().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return doc;
  }

  async listBranches(includeClosed = false): Promise<Branch[]> {
    const filter = includeClosed ? {} : { status: "active" as const };
    return this.branches().find(filter).sort({ name: 1 }).toArray();
  }

  async listInstructors(): Promise<Instructor[]> {
    const rows = await this.instructors().find({}).sort({ name: 1 }).toArray();
    return rows.filter((item) => !/^test\d*$/i.test(item.name.trim()));
  }

  async listGroups(filter: { branchId?: string; includeClosedBranches?: boolean } = {}): Promise<TrainingGroup[]> {
    const query: Record<string, unknown> = {};
    if (filter.branchId) {
      query.branchId = filter.branchId;
    }
    return this.groups().find(query).sort({ name: 1 }).toArray();
  }

  async findBranchById(id: string): Promise<Branch | null> {
    return this.branches().findOne({ _id: id });
  }

  async findGroupById(id: string): Promise<TrainingGroup | null> {
    return this.groups().findOne({ _id: id });
  }

  async findInstructorById(id: string): Promise<Instructor | null> {
    return this.instructors().findOne({ _id: id });
  }

  async applyGroupOverride(
    groupId: string,
    override: {
      timeNote?: string | null;
      weekdays?: Weekday[];
      note?: string | null;
      updatedByTelegramId: string;
    },
  ): Promise<TrainingGroup | null> {
    const existing = await this.groups().findOne({ _id: groupId });
    if (!existing) {
      return null;
    }
    const localOverride = {
      timeNote: override.timeNote !== undefined ? override.timeNote : (existing.localOverride?.timeNote ?? null),
      weekdays: override.weekdays ?? existing.localOverride?.weekdays,
      note: override.note !== undefined ? override.note : (existing.localOverride?.note ?? null),
      updatedAt: new Date(),
      updatedByTelegramId: override.updatedByTelegramId,
    };
    await this.groups().updateOne({ _id: groupId }, { $set: { localOverride, updatedAt: new Date() } });
    return this.groups().findOne({ _id: groupId });
  }
}
