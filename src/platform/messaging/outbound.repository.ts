import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";

import type { OutboundMedia } from "../conversation/types.js";

export type OutboundDelivery = {
  chatId: string;
  title: string;
  status: "queued" | "sent" | "failed";
  error: string | null;
  telegramMessageId: number | null;
};

export type OutboundMessage = {
  _id: string;
  actorTelegramId: string;
  text: string;
  media: OutboundMedia[];
  deliveries: OutboundDelivery[];
  createdAt: Date;
  updatedAt: Date;
};

export class OutboundRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<OutboundMessage> {
    return this.mongo.getDb().collection("outbound_messages");
  }

  async create(
    actorTelegramId: string,
    text: string,
    deliveries: OutboundDelivery[],
    media: OutboundMedia[] = [],
  ): Promise<OutboundMessage> {
    const now = new Date();
    const doc: OutboundMessage = {
      _id: new ObjectId().toHexString(),
      actorTelegramId,
      text,
      media,
      deliveries,
      createdAt: now,
      updatedAt: now,
    };
    await this.col().insertOne(doc);
    return doc;
  }

  async findById(id: string): Promise<OutboundMessage | null> {
    const doc = await this.col().findOne({ _id: id });
    if (!doc) {
      return null;
    }
    return { ...doc, media: doc.media ?? [] };
  }

  async listRecentByActor(actorTelegramId: string, limit = 8): Promise<OutboundMessage[]> {
    const docs = await this.col()
      .find({ actorTelegramId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 20))
      .toArray();
    return docs.map((doc) => ({ ...doc, media: doc.media ?? [] }));
  }

  /** Последние объявления бота, реально ушедшие в этот Telegram-чат. */
  async listRecentForChat(telegramChatId: string, limit = 3): Promise<OutboundMessage[]> {
    const docs = await this.col()
      .find({
        "deliveries.chatId": telegramChatId,
        "deliveries.status": "sent",
      })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 8))
      .toArray();
    return docs.map((doc) => ({ ...doc, media: doc.media ?? [] }));
  }

  async countSince(from: Date): Promise<number> {
    return this.col().countDocuments({ createdAt: { $gte: from } });
  }

  async markDelivery(id: string, chatId: string, patch: Partial<OutboundDelivery>): Promise<OutboundMessage | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) {
      set["deliveries.$.status"] = patch.status;
    }
    if (patch.error !== undefined) {
      set["deliveries.$.error"] = patch.error;
    }
    if (patch.telegramMessageId !== undefined) {
      set["deliveries.$.telegramMessageId"] = patch.telegramMessageId;
    }
    await this.col().updateOne({ _id: id, "deliveries.chatId": chatId }, { $set: set });
    return this.findById(id);
  }
}
