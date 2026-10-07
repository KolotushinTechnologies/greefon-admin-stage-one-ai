import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3890),
  MONGODB_URI: z.string().min(1),
  TG_BOT_TOKEN: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  RABBITMQ_URL: z.string().min(1).default("amqp://greefon:greefon@127.0.0.1:5672"),
  EMBEDDING_MODEL: z.string().min(1).default("Xenova/multilingual-e5-small"),
  BOOTSTRAP_TELEGRAM_IDS: z.string().default(""),
  MASTER_RECOVERY_PHRASE: z.string().default(""),
  WEBHOOK_URL: z.string().optional().default(""),
  WEBHOOK_SECRET: z.string().optional().default(""),
  CRM_BASE_URL: z.string().min(1).default("https://st.greefon.com"),
  CRM_LOGIN: z.string().default(""),
  CRM_PASSWORD: z.string().default(""),
  WEB_ORIGIN: z.string().optional().default(""),
  JWT_SECRET: z.string().optional().default(""),
  PRODUCT_NAME: z.string().optional().default("Грифон OS"),
  ASSISTANT_NAME: z.string().optional().default("Грифон"),
  ASSISTANT_CHAT_PLACEHOLDER: z.string().optional().default(""),
  ASSISTANT_THINKING_LABEL: z.string().optional().default(""),
  ASSISTANT_OPEN_LABEL: z.string().optional().default(""),
  SBER_AUTH_KEY: z.string().min(1),
  SBER_CLIENTID: z.string().optional().default(""),
  SBER_CLIENT_SECRET: z.string().optional().default(""),
  SBER_SCOPE: z.string().optional().default("GIGACHAT_API_PERS"),
  SBER_BASE_URL: z.string().optional().default("https://api.giga.chat/v1"),
  SBER_MODEL: z.string().min(1).default("GigaChat-2-Max"),
  SBER_TLS_INSECURE: z
    .string()
    .optional()
    .default("true")
    .transform((value) => value.trim().toLowerCase() !== "false"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const env = envSchema.parse(source);
  if (env.NODE_ENV === "production" && parseBootstrapTelegramIds(env.BOOTSTRAP_TELEGRAM_IDS).length === 0) {
    throw new Error("В production нужен BOOTSTRAP_TELEGRAM_IDS.");
  }
  if (env.WEBHOOK_URL.length > 0 && env.WEBHOOK_SECRET.trim().length < 16) {
    throw new Error("WEBHOOK_SECRET должен быть не короче 16 символов, если включён webhook.");
  }
  return env;
}

export function parseBootstrapTelegramIds(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => /^\d{5,}$/.test(item));
}
