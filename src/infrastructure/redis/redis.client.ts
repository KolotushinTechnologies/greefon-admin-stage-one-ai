import { Redis } from "ioredis";
import type { AppEnv } from "../../config/env.js";

export class RedisConnection {
  readonly client: Redis;

  constructor(env: AppEnv) {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
