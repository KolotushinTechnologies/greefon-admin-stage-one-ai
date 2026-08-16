import { loadEnv } from "../config/env.js";
import { buildContainer } from "../di/container.js";
import { connectInfrastructure } from "./bootstrap.js";
import { startWorkers } from "../infrastructure/bullmq/workers.js";

const env = loadEnv();
const container = buildContainer(env);
await connectInfrastructure(container);

const { queues, redis, messenger, outbound, send, knowledge, crmSync, digest, events } = container.cradle;

await queues.digest.add(
  "evening",
  { reason: "evening" },
  { repeat: { pattern: "0 20 * * *", tz: "Europe/Moscow" }, jobId: "digest-evening" },
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
