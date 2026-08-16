import type { RedisConnection } from "../../infrastructure/redis/redis.client.js";
import {
  conversationStateSchema,
  pendingMediaDraftSchema,
  pendingSendSchema,
  type ConversationMessage,
  type ConversationState,
  type OutboundMedia,
  type PendingMediaDraft,
  type PendingSend,
  type PendingUi,
} from "./types.js";

const TTL_SECONDS = 60 * 60 * 12;
const HISTORY_LIMIT = 24;

export class ConversationStore {
  constructor(private readonly redis: RedisConnection) {}

  private key(telegramUserId: string, lane = "admin", chatId?: string | null): string {
    const scope = chatId && chatId.trim().length > 0 ? `:chat:${chatId.trim()}` : "";
    return `conversation:${lane}:${telegramUserId}${scope}`;
  }

  private pendingSendKey(telegramUserId: string): string {
    return `conversation:admin:${telegramUserId}:pending-send`;
  }

  private pendingMediaKey(telegramUserId: string): string {
    return `conversation:admin:${telegramUserId}:pending-media`;
  }

  private albumKey(telegramUserId: string, mediaGroupId: string): string {
    return `conversation:admin:${telegramUserId}:album:${mediaGroupId}`;
  }

  async load(telegramUserId: string, lane = "admin", chatId?: string | null): Promise<ConversationState> {
    const [raw, pendingRaw] = await Promise.all([
      this.redis.client.get(this.key(telegramUserId, lane, chatId)),
      this.redis.client.get(this.pendingSendKey(telegramUserId)),
    ]);
    const base = this.parseState(telegramUserId, raw);
    const pendingSend = lane === "admin" ? this.parsePending(pendingRaw) : null;
    return { ...base, pendingSend };
  }

  async append(
    telegramUserId: string,
    message: ConversationMessage,
    lane = "admin",
    chatId?: string | null,
  ): Promise<ConversationState> {
    const state = await this.load(telegramUserId, lane, chatId);
    state.history = [...state.history, message].slice(-HISTORY_LIMIT);
    state.updatedAt = new Date().toISOString();
    await this.save(state, lane, chatId);
    return state;
  }

  async setPendingSend(telegramUserId: string, pending: PendingSend | null): Promise<void> {
    if (pending) {
      await this.redis.client.set(this.pendingSendKey(telegramUserId), JSON.stringify(pending), "EX", TTL_SECONDS);
    } else {
      await this.redis.client.del(this.pendingSendKey(telegramUserId));
    }
    const state = await this.load(telegramUserId);
    state.updatedAt = new Date().toISOString();
    await this.save(state, "admin");
  }

  async takePendingSend(telegramUserId: string, confirmationId?: string): Promise<PendingSend | null> {
    const raw = await this.redis.client.getdel(this.pendingSendKey(telegramUserId));
    const pending = this.parsePending(raw);
    if (!pending) {
      return null;
    }
    if (confirmationId && pending.confirmationId !== confirmationId) {
      await this.redis.client.set(this.pendingSendKey(telegramUserId), JSON.stringify(pending), "EX", TTL_SECONDS);
      return null;
    }
    const state = await this.load(telegramUserId);
    state.updatedAt = new Date().toISOString();
    await this.save(state, "admin");
    return pending;
  }

  async clearPending(telegramUserId: string): Promise<void> {
    await this.setPendingSend(telegramUserId, null);
  }

  async setPendingMedia(telegramUserId: string, draft: PendingMediaDraft | null): Promise<void> {
    if (draft) {
      await this.redis.client.set(this.pendingMediaKey(telegramUserId), JSON.stringify(draft), "EX", TTL_SECONDS);
      await this.clearBroadcastTargets(telegramUserId);
      return;
    }
    await this.redis.client.del(this.pendingMediaKey(telegramUserId));
  }

  async getPendingMedia(telegramUserId: string): Promise<PendingMediaDraft | null> {
    const raw = await this.redis.client.get(this.pendingMediaKey(telegramUserId));
    if (!raw) {
      return null;
    }
    try {
      const parsed = pendingMediaDraftSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async takePendingMedia(telegramUserId: string): Promise<PendingMediaDraft | null> {
    const raw = await this.redis.client.getdel(this.pendingMediaKey(telegramUserId));
    await this.clearBroadcastTargets(telegramUserId);
    if (!raw) {
      return null;
    }
    try {
      const parsed = pendingMediaDraftSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private broadcastTargetsKey(telegramUserId: string): string {
    return `conversation:admin:${telegramUserId}:broadcast-targets`;
  }

  async getBroadcastTargets(telegramUserId: string): Promise<string[]> {
    const raw = await this.redis.client.get(this.broadcastTargetsKey(telegramUserId));
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
    } catch {
      return [];
    }
  }

  async setBroadcastTargets(telegramUserId: string, chatDocIds: string[]): Promise<void> {
    const unique = [...new Set(chatDocIds)];
    if (unique.length === 0) {
      await this.clearBroadcastTargets(telegramUserId);
      return;
    }
    await this.redis.client.set(this.broadcastTargetsKey(telegramUserId), JSON.stringify(unique), "EX", TTL_SECONDS);
  }

  async toggleBroadcastTarget(telegramUserId: string, chatDocId: string): Promise<string[]> {
    const current = await this.getBroadcastTargets(telegramUserId);
    const next = current.includes(chatDocId)
      ? current.filter((id) => id !== chatDocId)
      : [...current, chatDocId];
    await this.setBroadcastTargets(telegramUserId, next);
    return next;
  }

  async clearBroadcastTargets(telegramUserId: string): Promise<void> {
    await this.redis.client.del(this.broadcastTargetsKey(telegramUserId));
  }

  async appendAlbumItem(
    telegramUserId: string,
    mediaGroupId: string,
    item: OutboundMedia,
    caption: string | null,
  ): Promise<number> {
    const key = this.albumKey(telegramUserId, mediaGroupId);
    await this.redis.client.rpush(key, JSON.stringify({ item, caption }));
    await this.redis.client.expire(key, 60);
    return this.redis.client.llen(key);
  }

  async takeAlbum(
    telegramUserId: string,
    mediaGroupId: string,
  ): Promise<{ media: OutboundMedia[]; caption: string | null }> {
    const key = this.albumKey(telegramUserId, mediaGroupId);
    const rows = await this.redis.client.lrange(key, 0, -1);
    await this.redis.client.del(key);
    const media: OutboundMedia[] = [];
    let caption: string | null = null;
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row) as { item: OutboundMedia; caption: string | null };
        media.push(parsed.item);
        if (!caption && parsed.caption && parsed.caption.trim().length > 0) {
          caption = parsed.caption.trim();
        }
      } catch {
        // skip
      }
    }
    return { media, caption };
  }

  async setRouteAddress(telegramUserId: string, address: string | null): Promise<void> {
    const key = `conversation:parent:${telegramUserId}:route`;
    if (address && address.trim().length > 0) {
      await this.redis.client.set(key, address.trim(), "EX", TTL_SECONDS);
      return;
    }
    await this.redis.client.del(key);
  }

  async getRouteAddress(telegramUserId: string): Promise<string | null> {
    return this.redis.client.get(`conversation:parent:${telegramUserId}:route`);
  }

  async setPendingUi(telegramUserId: string, pending: PendingUi | null): Promise<void> {
    const state = await this.load(telegramUserId);
    state.pendingUi = pending;
    state.updatedAt = new Date().toISOString();
    await this.save(state, "admin");
  }

  private parseState(telegramUserId: string, raw: string | null): ConversationState {
    const empty: ConversationState = {
      actorTelegramId: telegramUserId,
      history: [],
      pendingSend: null,
      pendingUi: null,
      updatedAt: new Date().toISOString(),
    };
    if (!raw) {
      return empty;
    }
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const parsed = conversationStateSchema.safeParse({
        ...data,
        pendingSend: null,
        pendingUi: data.pendingUi ?? null,
      });
      return parsed.success ? parsed.data : empty;
    } catch {
      return empty;
    }
  }

  private parsePending(raw: string | null): PendingSend | null {
    if (!raw) {
      return null;
    }
    try {
      const parsed = pendingSendSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async save(state: ConversationState, lane = "admin", chatId?: string | null): Promise<void> {
    const stored = { ...state, pendingSend: null };
    await this.redis.client.set(
      this.key(state.actorTelegramId, lane, chatId),
      JSON.stringify(stored),
      "EX",
      TTL_SECONDS,
    );
  }
}
