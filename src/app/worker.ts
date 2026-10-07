import { loadEnv } from "../config/env.js";
import { buildContainer } from "../di/container.js";
import { connectInfrastructure } from "./bootstrap.js";
import { startWorkers } from "../infrastructure/bullmq/workers.js";

const env = loadEnv();
const container = buildContainer(env);
await connectInfrastructure(container);

const { queues, redis, messenger, outbound, send, knowledge, crmSync, digest, problemRadar, dailyReport, events } =
  container.cradle;

await queues.digest.add(
  "evening",
  { reason: "report" },
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

const workers = startWorkers({
  connection: redis.client.duplicate(),
  queues,
  messenger,
  outbound,
  send,
  knowledge,
  crmSync,
  digest,
  problemRadar,
  dailyReport,
});

const shutdown = async () => {
  await Promise.all(workers.map((worker) => worker.close()));
  await queues.close();
  await events.close();
  await redis.close();
  await container.cradle.mongo.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
