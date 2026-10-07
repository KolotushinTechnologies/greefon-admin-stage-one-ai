import { loadEnv } from "../config/env.js";
import { buildContainer } from "../di/container.js";
import { startWorkers } from "../infrastructure/bullmq/workers.js";
import { buildHttpServer, connectInfrastructure, startTelegramIngress } from "./bootstrap.js";

const env = loadEnv();
const container = buildContainer(env);

await connectInfrastructure(container);

try {
  const { reconcileKnowledge } = await import("../platform/knowledge/reconcile.js");
  await reconcileKnowledge(
    container.cradle.knowledgeDocs,
    container.cradle.knowledge,
    container.cradle.org,
  );
} catch (error) {
  appLogError(error);
}

if (env.BOOTSTRAP_TELEGRAM_IDS.trim().length === 0) {
  console.warn("BOOTSTRAP_TELEGRAM_IDS пустой — суперадмина некому выдать, бот будет всех гонять.");
}

function appLogError(error: unknown): void {
  console.error("knowledge reconcile", error);
}

if (env.NODE_ENV === "development") {
  const { queues, redis, messenger, outbound, send, knowledge, crmSync, digest, problemRadar } = container.cradle;
  await queues.digest.add(
    "evening",
    { reason: "evening" },
    { repeat: { pattern: "0 20 * * *", tz: "Europe/Moscow" }, jobId: "digest-evening" },
  );
  await queues.digest.add(
    "morning",
    { reason: "morning" },
    { repeat: { pattern: "0 9 * * *", tz: "Europe/Moscow" }, jobId: "digest-morning" },
  );
  await queues.digest.add(
    "radar",
    { reason: "radar" },
    { repeat: { pattern: "0 13 * * *", tz: "Europe/Moscow" }, jobId: "digest-radar" },
  );
  startWorkers({
    connection: redis.client.duplicate(),
    queues,
    messenger,
    outbound,
    send,
    knowledge,
    crmSync,
    digest,
    problemRadar,
  });
}

const app = await buildHttpServer(container);
await app.listen({ port: env.PORT, host: "0.0.0.0" });

void startTelegramIngress(container).catch((error) => {
  app.log.error(error, "telegram ingress");
});

const shutdown = async () => {
  await app.close();
  await container.cradle.telegramChannel.bot.stop();
  await container.cradle.queues.close();
  await container.cradle.events.close();
  await container.cradle.redis.close();
  await container.cradle.mongo.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
