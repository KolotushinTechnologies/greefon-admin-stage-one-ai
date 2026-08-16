import { webhookCallback } from "grammy";
import Fastify from "fastify";
import cors from "@fastify/cors";
import type { AwilixContainer } from "awilix";
import { ensureMongoIndexes } from "../infrastructure/mongo/indexes.js";
import type { AppCradle } from "../di/container.js";
import { registerOsRoutes } from "../platform/os-api/os.routes.js";

export async function connectInfrastructure(container: AwilixContainer<AppCradle>): Promise<void> {
  const { mongo, redis, events, staff, knowledgeDocs, knowledge } = container.cradle;
  await mongo.connect();
  await ensureMongoIndexes(mongo.getDb());
  await redis.ping();
  await events.connect();
  await staff.bootstrapFromEnv();
  const { seedStarterTopics } = await import("../platform/knowledge/seed-topics.js");
  const { seedMasterProfile } = await import("../platform/knowledge/seed-master.js");
  const { seedGreefonSite } = await import("../platform/knowledge/seed-greefon.js");
  await seedStarterTopics(knowledgeDocs, knowledge);
  await seedMasterProfile(knowledgeDocs, knowledge);
  await seedGreefonSite(knowledgeDocs, knowledge);
}

export async function buildHttpServer(container: AwilixContainer<AppCradle>) {
  const { env, telegramChannel, mongo, redis, staff, users, osQuery, adminAgent } = container.cradle;
  const app = Fastify({ logger: true });

  telegramChannel.register();
  await telegramChannel.bot.init();

  await app.register(cors, {
    origin: env.WEB_ORIGIN.length > 0 ? [env.WEB_ORIGIN, "http://127.0.0.1:5179"] : true,
    credentials: true,
  });

  app.get("/health", async () => {
    await redis.ping();
    await mongo.getDb().command({ ping: 1 });
    return { ok: true, service: "greefon-os", agent: "admin" };
  });

  registerOsRoutes(app, {
    env,
    staff,
    users,
    os: osQuery,
    adminAgent,
    botUsername: telegramChannel.bot.botInfo.username ?? null,
  });

  if (env.WEBHOOK_URL.length > 0) {
    const handler = webhookCallback(telegramChannel.bot, "fastify", {
      secretToken: env.WEBHOOK_SECRET,
    });
    app.post("/telegram/webhook", handler);
  }

  return app;
}

export async function startTelegramIngress(container: AwilixContainer<AppCradle>): Promise<void> {
  const { env, telegramChannel } = container.cradle;
  if (env.WEBHOOK_URL.length > 0) {
    await telegramChannel.bot.api.setWebhook(`${env.WEBHOOK_URL}/telegram/webhook`, {
      secret_token: env.WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query", "my_chat_member", "chat_member"],
    });
    return;
  }
  await telegramChannel.bot.api.deleteWebhook({ drop_pending_updates: false });
  await telegramChannel.bot.start({
    allowed_updates: ["message", "callback_query", "my_chat_member"],
  });
}
