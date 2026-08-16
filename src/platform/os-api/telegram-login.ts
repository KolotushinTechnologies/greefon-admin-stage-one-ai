import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TelegramLoginPayload = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export function verifyTelegramLogin(botToken: string, data: TelegramLoginPayload): boolean {
  if (Math.abs(Date.now() / 1000 - data.auth_date) > 60 * 60 * 24) {
    return false;
  }
  const { hash, ...rest } = data;
  const check = Object.entries(rest)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const digest = createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
