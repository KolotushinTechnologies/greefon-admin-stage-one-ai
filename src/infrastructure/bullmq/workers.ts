import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import {
  QUEUE_BROADCAST,
  QUEUE_CRM_SYNC,
  QUEUE_DIGEST,
  QUEUE_REINDEX,
  QUEUE_TELEGRAM_SEND,
  type BroadcastJob,
  type CrmSyncJob,
  type DigestJob,
  type ReindexJob,
  type TelegramSendJob,
  type JobQueues,
} from "./queues.js";
import type { TelegramMessenger } from "../telegram/telegram.messenger.js";
import type { OutboundRepository } from "../../platform/messaging/outbound.repository.js";
import type { SendService } from "../../platform/messaging/send.service.js";
import type { KnowledgeService } from "../../platform/knowledge/knowledge.service.js";
import type { CrmSyncService } from "../../platform/org/crm-sync.service.js";
import type { DigestService } from "../../platform/analytics/digest.service.js";
import type { DailyReportService } from "../../platform/analytics/daily-report.service.js";
import type { ProblemRadarService } from "../../platform/copilot/problem-radar.service.js";

export function startWorkers(input: {
  connection: Redis;
  queues: JobQueues;
  messenger: TelegramMessenger;
  outbound: OutboundRepository;
  send: SendService;
  knowledge: KnowledgeService;
  crmSync: CrmSyncService;
  digest: DigestService;
  problemRadar: ProblemRadarService;
  dailyReport: DailyReportService;
}): Worker[] {
  const sendWorker = new Worker<TelegramSendJob>(
    QUEUE_TELEGRAM_SEND,
    async (job) => {
      const result = await input.messenger.sendOutbound(job.data.chatId, job.data.text, job.data.media ?? []);
      if (!result.ok) {
        throw new Error(result.error ?? "Telegram не принял сообщение");
      }
      await input.outbound.markDelivery(job.data.outboundId, job.data.chatId, {
        status: "sent",
        error: null,
        telegramMessageId: result.telegramMessageId,
      });
    },
    { connection: input.connection, concurrency: 2 },
  );

  sendWorker.on("failed", (job) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) {
      return;
    }
    void input.outbound.markDelivery(job.data.outboundId, job.data.chatId, {
      status: "failed",
      error: job.failedReason || "Не отправилось",
      telegramMessageId: null,
    });
  });

  const broadcastWorker = new Worker<BroadcastJob>(
    QUEUE_BROADCAST,
    async (job) => {
      const outbound = await input.outbound.findById(job.data.outboundId);
      if (!outbound) {
        return;
      }
      for (const [index, delivery] of outbound.deliveries.entries()) {
        if (delivery.status !== "queued") {
          continue;
        }
        await input.queues.telegramSend.add(
          "send",
          {
            outboundId: outbound._id,
            chatId: delivery.chatId,
            text: outbound.text,
            media: outbound.media ?? [],
          },
          { delay: index * 400, jobId: `tg-${outbound._id}-${delivery.chatId}` },
        );
      }
      await waitForDeliveries(input.outbound, outbound._id);
      const report = await input.send.report(outbound._id);
      await input.messenger.sendText(outbound.actorTelegramId, report);
    },
    { connection: input.connection, concurrency: 1 },
  );

  const reindexWorker = new Worker<ReindexJob>(
    QUEUE_REINDEX,
    async (job) => {
      await input.knowledge.reindexDoc(job.data.docId);
    },
    { connection: input.connection, concurrency: 1 },
  );

  const crmWorker = new Worker<CrmSyncJob>(
    QUEUE_CRM_SYNC,
    async () => {
      await input.crmSync.sync();
    },
    { connection: input.connection, concurrency: 1 },
  );

  const digestWorker = new Worker<DigestJob>(
    QUEUE_DIGEST,
    async (job) => {
      if (job.data.reason === "morning") {
        await input.digest.sendMorningTasks();
        return;
      }
      if (job.data.reason === "radar") {
        await input.problemRadar.sendRadar();
        return;
      }
      if (job.data.reason === "report" || job.data.reason === "evening") {
        await input.dailyReport.sendDailyReport();
        return;
      }
      await input.digest.sendEvening();
    },
    { connection: input.connection, concurrency: 1 },
  );

  return [sendWorker, broadcastWorker, reindexWorker, crmWorker, digestWorker];
}

async function waitForDeliveries(outbound: OutboundRepository, id: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const current = await outbound.findById(id);
    if (!current) {
      return;
    }
    const pending = current.deliveries.some((item) => item.status === "queued");
    if (!pending) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
