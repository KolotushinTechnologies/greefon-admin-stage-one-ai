import type { RedisConnection } from "../../infrastructure/redis/redis.client.js";

export type UsageKind = "parent_message" | "escalation";

export class UsageMeter {
  constructor(private readonly redis: RedisConnection) {}

  moscowDay(at = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  }

  moscowDayStart(day = this.moscowDay()): Date {
    return new Date(`${day}T00:00:00+03:00`);
  }

  async bump(kind: UsageKind): Promise<void> {
    await this.redis.client.incr(this.key(kind));
    await this.redis.client.expire(this.key(kind), 60 * 60 * 48);
  }

  async snapshot(day = this.moscowDay()): Promise<{ parentMessages: number; escalations: number }> {
    const [parentMessages, escalations] = await Promise.all([
      this.redis.client.get(this.key("parent_message", day)),
      this.redis.client.get(this.key("escalation", day)),
    ]);
    return {
      parentMessages: Number(parentMessages ?? 0),
      escalations: Number(escalations ?? 0),
    };
  }

  private key(kind: UsageKind, day = this.moscowDay()): string {
    return `usage:${day}:${kind}`;
  }
}
