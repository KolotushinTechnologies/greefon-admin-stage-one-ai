import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import type { BotMembership, ChatAudience, ChatCategory, ChatRecord } from "./types.js";

export class ChatRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<ChatRecord> {
    return this.mongo.getDb().collection("chats");
  }

  async upsertDiscovered(input: {
    telegramChatId: string;
    title: string;
    telegramType: string;
    botStatus: BotMembership;
  }): Promise<ChatRecord> {
    const now = new Date();
    const existing = await this.col().findOne({ telegramChatId: input.telegramChatId });
    if (existing) {
      await this.col().updateOne(
        { _id: existing._id },
        {
          $set: {
            title: input.title,
            telegramType: input.telegramType,
            botStatus: input.botStatus,
            updatedAt: now,
          },
        },
      );
      return { ...existing, title: input.title, telegramType: input.telegramType, botStatus: input.botStatus, updatedAt: now };
    }
    const doc: ChatRecord = {
      _id: new ObjectId().toHexString(),
      telegramChatId: input.telegramChatId,
      title: input.title,
      telegramType: input.telegramType,
      branchId: null,
      groupId: null,
      audience: "unknown",
      category: "other",
      labels: [],
      botStatus: input.botStatus,
      labeledAt: null,
      labeledByTelegramId: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.col().insertOne(doc);
    return doc;
  }

  async label(
    chatId: string,
    patch: {
      branchId: string | null;
      groupId: string | null;
      audience: ChatAudience;
      category: ChatCategory;
      labels: string[];
      labeledByTelegramId: string;
    },
  ): Promise<ChatRecord | null> {
    const existing = await this.findByTelegramId(chatId) ?? await this.col().findOne({ _id: chatId });
    if (!existing) {
      return null;
    }
    const next: ChatRecord = {
      ...existing,
      branchId: patch.branchId,
      groupId: patch.groupId,
      audience: patch.audience,
      category: patch.category,
      labels: patch.labels,
      labeledAt: new Date(),
      labeledByTelegramId: patch.labeledByTelegramId,
      updatedAt: new Date(),
    };
    await this.col().replaceOne({ _id: existing._id }, next);
    return next;
  }

  async findByTelegramId(telegramChatId: string): Promise<ChatRecord | null> {
    return this.col().findOne({ telegramChatId });
  }

  async findById(id: string): Promise<ChatRecord | null> {
    return this.col().findOne({ _id: id });
  }

  async listAll(): Promise<ChatRecord[]> {
    return this.col().find({ botStatus: { $in: ["member", "admin", "unknown"] } }).sort({ title: 1 }).toArray();
  }

  async findByFilter(filter: {
    branchId?: string;
    groupId?: string;
    audience?: ChatAudience;
    category?: ChatCategory;
  }): Promise<ChatRecord[]> {
    const query: Record<string, unknown> = {
      botStatus: { $in: ["member", "admin", "unknown"] },
    };
    if (filter.branchId) {
      query.branchId = filter.branchId;
    }
    if (filter.groupId) {
      query.groupId = filter.groupId;
    }
    if (filter.audience) {
      query.audience = filter.audience;
    }
    if (filter.category) {
      query.category = filter.category;
    }
    return this.col().find(query).toArray();
  }
}
