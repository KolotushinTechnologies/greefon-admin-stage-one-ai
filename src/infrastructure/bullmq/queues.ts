import { Queue, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";

export const QUEUE_TELEGRAM_SEND = "telegram.send";
export const QUEUE_BROADCAST = "broadcast.execute";
export const QUEUE_REINDEX = "embeddings.reindex";
export const QUEUE_CRM_SYNC = "crm.sync";
export const QUEUE_DIGEST = "digest.evening";

export type TelegramSendJob = {
  outboundId: string;
  chatId: string;
  text: string;
  media?: Array<{ kind: "photo" | "video" | "document"; fileId: string }>;
};

export type BroadcastJob = {
  outboundId: string;
};

export type ReindexJob = {
  docId: string;
};

export type CrmSyncJob = {
  reason: "schedule" | "manual";
};

export type DigestJob = {
  reason: "evening" | "morning" | "radar" | "report";
};

const defaultJob: JobsOptions = {
  removeOnComplete: 200,
  removeOnFail: 200,
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
};

export class JobQueues {
  readonly telegramSend: Queue<TelegramSendJob>;
  readonly broadcast: Queue<BroadcastJob>;
  readonly reindex: Queue<ReindexJob>;
  readonly crmSync: Queue<CrmSyncJob>;
  readonly digest: Queue<DigestJob>;

  constructor(connection: Redis) {
    const opts = { connection, defaultJobOptions: defaultJob };
    this.telegramSend = new Queue(QUEUE_TELEGRAM_SEND, opts);
    this.broadcast = new Queue(QUEUE_BROADCAST, opts);
    this.reindex = new Queue(QUEUE_REINDEX, opts);
    this.crmSync = new Queue(QUEUE_CRM_SYNC, opts);
    this.digest = new Queue(QUEUE_DIGEST, opts);
  }

  async close(): Promise<void> {
    await Promise.all([
      this.telegramSend.close(),
      this.broadcast.close(),
      this.reindex.close(),
      this.crmSync.close(),
      this.digest.close(),
    ]);
  }
}
