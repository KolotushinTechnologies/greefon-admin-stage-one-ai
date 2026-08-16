import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import type { NoteStatus, SuperadminNote } from "./types.js";

export class NotesRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<SuperadminNote> {
    return this.mongo.getDb().collection("superadmin_notes");
  }

  async insert(input: Omit<SuperadminNote, "_id" | "createdAt" | "updatedAt">): Promise<SuperadminNote> {
    const now = new Date();
    const doc: SuperadminNote = {
      ...input,
      _id: new ObjectId().toHexString(),
      createdAt: now,
      updatedAt: now,
    };
    await this.col().insertOne(doc);
    return doc;
  }

  async findById(id: string): Promise<SuperadminNote | null> {
    return this.col().findOne({ _id: id });
  }

  async list(input: { status?: NoteStatus; limit?: number } = {}): Promise<SuperadminNote[]> {
    const query: Record<string, unknown> = {};
    if (input.status) {
      query.status = input.status;
    }
    return this.col()
      .find(query)
      .sort({ updatedAt: -1 })
      .limit(input.limit ?? 50)
      .toArray();
  }

  async update(
    id: string,
    patch: Partial<Pick<SuperadminNote, "title" | "body" | "tags" | "status" | "updatedByTelegramId">>,
  ): Promise<SuperadminNote | null> {
    await this.col().updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } });
    return this.findById(id);
  }
}
