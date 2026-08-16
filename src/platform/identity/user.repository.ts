import { ObjectId, type Collection } from "mongodb";
import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import { MASTER_KOLOTUSHIN, type ActorKind, type StaffRole, type StaffUser, type UserStatus } from "./types.js";

export class UserRepository {
  constructor(private readonly mongo: MongoConnection) {}

  private col(): Collection<StaffUser> {
    return this.mongo.getDb().collection("users");
  }

  async findByTelegramId(telegramUserId: string): Promise<StaffUser | null> {
    const raw = await this.col().findOne({ telegramUserId });
    return raw ? this.hydrate(raw) : null;
  }

  async findByUsername(username: string): Promise<StaffUser | null> {
    const normalized = username.replace(/^@/, "").toLowerCase();
    const raw = await this.col().findOne({ username: normalized });
    return raw ? this.hydrate(raw) : null;
  }

  async listStaff(): Promise<StaffUser[]> {
    const rows = await this.col()
      .find({ role: { $ne: null }, status: "active" })
      .sort({ isOwner: -1, role: 1, displayName: 1 })
      .toArray();
    return rows.map((row) => this.hydrate(row));
  }

  /** Кто писал боту без роли штаба (и бывшие со снятым доступом). */
  async listVisitors(limit = 40): Promise<StaffUser[]> {
    const rows = await this.col()
      .find({
        isOwner: { $ne: true },
        $or: [{ role: null }, { role: { $exists: false } }, { status: "disabled" }],
      })
      .sort({ updatedAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 80))
      .toArray();
    return rows.map((row) => this.hydrate(row));
  }

  async findOwner(): Promise<StaffUser | null> {
    const raw = await this.col().findOne({ isOwner: true });
    if (raw) {
      return this.hydrate(raw);
    }
    const first = await this.col().find({ role: "superadmin" }).sort({ createdAt: 1 }).limit(1).toArray();
    return first[0] ? this.hydrate(first[0]) : null;
  }

  async upsertStaff(input: {
    telegramUserId: string;
    username: string | null;
    displayName: string | null;
    role: StaffRole;
    status: UserStatus;
    isOwner?: boolean;
    honorific?: string | null;
    actorKind?: ActorKind;
  }): Promise<StaffUser> {
    const now = new Date();
    const username = input.username ? input.username.replace(/^@/, "").toLowerCase() : null;
    const $set: Record<string, unknown> = {
      role: input.role,
      status: input.status,
      updatedAt: now,
    };
    // username / displayName только в $set — иначе конфликт с $setOnInsert на том же path.
    if (username !== null) {
      $set.username = username;
    } else if (input.username === null) {
      $set.username = null;
    }
    if (input.isOwner === true) {
      $set.isOwner = true;
      $set.honorific = MASTER_KOLOTUSHIN;
      $set.displayName = MASTER_KOLOTUSHIN;
      $set.actorKind = "owner";
    } else {
      if (input.displayName !== null) {
        $set.displayName = input.displayName;
      }
      if (input.honorific !== undefined) {
        $set.honorific = input.honorific;
      }
      if (input.actorKind) {
        $set.actorKind = input.actorKind;
      }
    }
    await this.col().updateOne(
      { telegramUserId: input.telegramUserId },
      {
        $set,
        $setOnInsert: {
          _id: new ObjectId().toHexString(),
          telegramUserId: input.telegramUserId,
          createdAt: now,
          isOwner: false,
          actorKind: "staff",
          honorific: null,
        },
      },
      { upsert: true },
    );
    const user = await this.findByTelegramId(input.telegramUserId);
    if (!user) {
      throw new Error("Не смог сохранить пользователя");
    }
    return user;
  }

  async clearOwnerExcept(telegramUserId: string): Promise<void> {
    await this.col().updateMany(
      { isOwner: true, telegramUserId: { $ne: telegramUserId } },
      {
        $set: {
          isOwner: false,
          honorific: null,
          actorKind: "staff",
          updatedAt: new Date(),
        },
      },
    );
  }

  async markAsMaster(telegramUserId: string): Promise<StaffUser | null> {
    await this.col().updateOne(
      { telegramUserId },
      {
        $set: {
          isOwner: true,
          honorific: MASTER_KOLOTUSHIN,
          displayName: MASTER_KOLOTUSHIN,
          actorKind: "owner",
          role: "superadmin",
          status: "active",
          updatedAt: new Date(),
        },
      },
    );
    return this.findByTelegramId(telegramUserId);
  }

  async touchProfile(telegramUserId: string, username: string | null, displayName: string | null): Promise<void> {
    const current = await this.findByTelegramId(telegramUserId);
    const usernameNorm = username ? username.replace(/^@/, "").toLowerCase() : null;
    if (current?.isOwner) {
      await this.col().updateOne(
        { telegramUserId },
        {
          $set: {
            username: usernameNorm,
            displayName: MASTER_KOLOTUSHIN,
            honorific: MASTER_KOLOTUSHIN,
            updatedAt: new Date(),
          },
        },
      );
      return;
    }
    await this.col().updateOne(
      { telegramUserId },
      {
        $set: {
          username: usernameNorm,
          displayName,
          updatedAt: new Date(),
        },
      },
    );
  }

  async rememberVisitor(telegramUserId: string, username: string | null, displayName: string | null): Promise<void> {
    const existing = await this.findByTelegramId(telegramUserId);
    if (existing) {
      return;
    }
    const now = new Date();
    await this.col().insertOne({
      _id: new ObjectId().toHexString(),
      telegramUserId,
      username: username ? username.replace(/^@/, "").toLowerCase() : null,
      displayName,
      honorific: null,
      isOwner: false,
      actorKind: "parent",
      role: null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  async revoke(telegramUserId: string): Promise<boolean> {
    const current = await this.findByTelegramId(telegramUserId);
    if (current?.isOwner) {
      return false;
    }
    const result = await this.col().updateOne(
      { telegramUserId },
      { $set: { role: null, status: "disabled", updatedAt: new Date() } },
    );
    return result.matchedCount > 0;
  }

  private hydrate(raw: StaffUser): StaffUser {
    return {
      ...raw,
      honorific: raw.honorific ?? (raw.isOwner ? MASTER_KOLOTUSHIN : null),
      isOwner: raw.isOwner === true,
      displayName: raw.isOwner ? MASTER_KOLOTUSHIN : raw.displayName,
    };
  }
}
