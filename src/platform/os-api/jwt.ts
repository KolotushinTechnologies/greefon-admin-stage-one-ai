import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppEnv } from "../../config/env.js";

type JwtPayload = {
  sub: string;
  role: string;
  name: string;
  exp: number;
};

export function signStaffJwt(
  env: AppEnv,
  input: { telegramUserId: string; role: string; name: string },
): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: input.telegramUserId,
      role: input.role,
      name: input.name,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14,
    } satisfies JwtPayload),
  );
  const sig = b64url(hmac(env, `${header}.${payload}`));
  return `${header}.${payload}.${sig}`;
}

export function verifyStaffJwt(env: AppEnv, token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return null;
  }
  const [header, payload, sig] = parts;
  const expected = b64url(hmac(env, `${header}.${payload}`));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtPayload;
    if (data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function hmac(env: AppEnv, data: string): Buffer {
  const secret = env.JWT_SECRET.trim().length > 0 ? env.JWT_SECRET : env.TG_BOT_TOKEN;
  return createHmac("sha256", secret).update(data).digest();
}

function b64url(value: string | Buffer): string {
  const buf = typeof value === "string" ? Buffer.from(value) : value;
  return buf.toString("base64url");
}
