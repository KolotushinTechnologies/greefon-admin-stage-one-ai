import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppEnv } from "../../config/env.js";
import { AccessDeniedError } from "../shared/errors.js";
import { Ids } from "../shared/ids.js";
import type { StaffRole } from "../identity/types.js";
import { hasAtLeast } from "../identity/types.js";
import type { StaffService } from "../identity/staff.service.js";
import type { UserRepository } from "../identity/user.repository.js";
import type { AdminAgent } from "../../agents/admin/admin.agent.js";
import { signStaffJwt, verifyStaffJwt } from "./jwt.js";
import type { OsQueryService } from "./os.query.js";
import { productBrand } from "./brand.js";
import { verifyTelegramLogin, type TelegramLoginPayload } from "./telegram-login.js";

type Authed = {
  telegramUserId: string;
  role: string;
  name: string;
};

export function registerOsRoutes(
  app: FastifyInstance,
  deps: {
    env: AppEnv;
    staff: StaffService;
    users: UserRepository;
    os: OsQueryService;
    adminAgent: AdminAgent;
    botUsername: string | null;
  },
): void {
  app.get("/v1/auth/config", async () => ({
    devLogin: deps.env.NODE_ENV === "development",
    botUsername: deps.botUsername,
    brand: productBrand(deps.env),
  }));

  app.post("/v1/auth/telegram", async (request, reply) => {
    const body = request.body as TelegramLoginPayload;
    if (!body?.id || !body.hash || !body.auth_date) {
      return reply.code(400).send({ error: "Нет данных Telegram Login." });
    }
    if (!verifyTelegramLogin(deps.env.TG_BOT_TOKEN, body)) {
      return reply.code(401).send({ error: "Telegram подпись не сошлась." });
    }
    const telegramUserId = Ids.telegramUser(body.id);
    const displayName = [body.first_name, body.last_name].filter(Boolean).join(" ") || null;
    const user = await deps.staff.resolveStaff(telegramUserId, body.username ?? null, displayName);
    if (!user?.role) {
      return reply.code(403).send({ error: "Это штабная OS. Сначала роль в Telegram-боте." });
    }
    const token = signStaffJwt(deps.env, {
      telegramUserId: user.telegramUserId,
      role: user.role,
      name: user.honorific ?? user.displayName ?? displayName ?? "штаб",
    });
    return { token, user: publicUser(user.telegramUserId, user.role, user.honorific ?? user.displayName) };
  });

  app.post("/v1/auth/dev", async (_request, reply) => {
    if (deps.env.NODE_ENV !== "development") {
      return reply.code(404).send({ error: "Нет." });
    }
    const owner = await deps.users.findOwner();
    const fallback = owner ?? (await deps.users.listStaff())[0];
    if (!fallback?.role) {
      return reply.code(403).send({ error: "В штате никого нет. Напиши боту фразу Мастера." });
    }
    const token = signStaffJwt(deps.env, {
      telegramUserId: fallback.telegramUserId,
      role: fallback.role,
      name: fallback.honorific ?? fallback.displayName ?? "штаб",
    });
    return { token, user: publicUser(fallback.telegramUserId, fallback.role, fallback.honorific ?? fallback.displayName) };
  });

  app.get("/v1/me", async (request, reply) => {
    const auth = requireAuth(deps.env, request, reply);
    if (!auth) {
      return;
    }
    return { user: publicUser(auth.telegramUserId, auth.role, auth.name) };
  });

  app.get("/v1/today", async (request, reply) => {
    if (!requireAuth(deps.env, request, reply)) {
      return;
    }
    const query = request.query as Record<string, string | undefined>;
    return deps.os.today(query.branchCrmId ? { branchCrmId: query.branchCrmId } : {});
  });

  app.get("/v1/students", async (request, reply) => {
    const auth = requireAuth(deps.env, request, reply);
    if (!auth || !requireRole(auth, "admin", reply)) {
      return;
    }
    const query = request.query as Record<string, string | undefined>;
    return deps.os.listStudents({
      ...(query.q ? { q: query.q } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.branchCrmId ? { branchCrmId: query.branchCrmId } : {}),
      limit: clampInt(query.limit, 80, 200),
      offset: clampInt(query.offset, 0, 100000),
    });
  });

  app.get("/v1/students/:id", async (request, reply) => {
    const auth = requireAuth(deps.env, request, reply);
    if (!auth || !requireRole(auth, "admin", reply)) {
      return;
    }
    const { id } = request.params as { id: string };
    const student = await deps.os.getStudent(id);
    if (!student) {
      return reply.code(404).send({ error: "Ученик не найден." });
    }
    return student;
  });

  app.get("/v1/guardians", async (request, reply) => {
    const auth = requireAuth(deps.env, request, reply);
    if (!auth || !requireRole(auth, "admin", reply)) {
      return;
    }
    const query = request.query as Record<string, string | undefined>;
    return deps.os.listGuardians({
      ...(query.q ? { q: query.q } : {}),
      limit: clampInt(query.limit, 80, 200),
      offset: clampInt(query.offset, 0, 100000),
    });
  });

  app.get("/v1/branches", async (request, reply) => {
    if (!requireAuth(deps.env, request, reply)) {
      return;
    }
    return { items: await deps.os.listBranches() };
  });

  app.get("/v1/groups", async (request, reply) => {
    if (!requireAuth(deps.env, request, reply)) {
      return;
    }
    return { items: await deps.os.listGroups() };
  });

  app.get("/v1/journal", async (request, reply) => {
    if (!requireAuth(deps.env, request, reply)) {
      return;
    }
    const query = request.query as { groupCrmId?: string; branchCrmId?: string; date?: string };
    return deps.os.journal({
      ...(query.groupCrmId ? { groupCrmId: query.groupCrmId } : {}),
      ...(query.branchCrmId ? { branchCrmId: query.branchCrmId } : {}),
      ...(query.date ? { date: query.date } : {}),
    });
  });

  app.get("/v1/visits", async (request, reply) => {
    if (!requireAuth(deps.env, request, reply)) {
      return;
    }
    const query = request.query as { groupCrmId?: string; branchCrmId?: string; date?: string };
    return deps.os.journal({
      ...(query.groupCrmId ? { groupCrmId: query.groupCrmId } : {}),
      ...(query.branchCrmId ? { branchCrmId: query.branchCrmId } : {}),
      ...(query.date ? { date: query.date } : {}),
    });
  });

  app.get("/v1/payments", async (request, reply) => {
    if (!requireAuth(deps.env, request, reply)) {
      return;
    }
    const query = request.query as Record<string, string | undefined>;
    const purpose = query.purpose;
    return deps.os.listPayments({
      purpose: purpose === "training" || purpose === "online" || purpose === "all" ? purpose : "all",
      ...(query.q ? { q: query.q } : {}),
      ...(query.branchCrmId ? { branchCrmId: query.branchCrmId } : {}),
      limit: clampInt(query.limit, 80, 200),
      offset: clampInt(query.offset, 0, 200000),
    });
  });

  app.get("/v1/events", async (request, reply) => {
    if (!requireAuth(deps.env, request, reply)) {
      return;
    }
    const query = request.query as { kind?: "comps" | "exams" | "camps" };
    return { items: await deps.os.listEvents(query.kind) };
  });

  app.get("/v1/staff", async (request, reply) => {
    const auth = requireAuth(deps.env, request, reply);
    if (!auth) {
      return;
    }
    try {
      const actor = await deps.users.findByTelegramId(auth.telegramUserId);
      if (!actor) {
        throw new AccessDeniedError();
      }
      const items = await deps.staff.listStaff(actor);
      return {
        items: items.map((person) =>
          publicUser(person.telegramUserId, person.role ?? "", person.honorific ?? person.displayName),
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Нет доступа";
      return reply.code(403).send({ error: message });
    }
  });

  app.get("/v1/coverage", async (request, reply) => {
    if (!requireAuth(deps.env, request, reply)) {
      return;
    }
    return { items: await deps.os.coverage() };
  });

  app.get("/v1/insights", async (request, reply) => {
    if (!requireAuth(deps.env, request, reply)) {
      return;
    }
    const query = request.query as Record<string, string | undefined>;
    return deps.os.insights(query.branchCrmId ? { branchCrmId: query.branchCrmId } : {});
  });

  app.get("/v1/griffin/suggest", async (request, reply) => {
    if (!requireAuth(deps.env, request, reply)) {
      return;
    }
    const query = request.query as { path?: string };
    return { items: await deps.os.griffinSuggest(query.path ?? "/") };
  });

  app.post("/v1/griffin/ask", async (request, reply) => {
    const auth = requireAuth(deps.env, request, reply);
    if (!auth) {
      return;
    }
    const body = request.body as {
      text?: string;
      branchCrmId?: string;
      path?: string;
      history?: Array<{ role: "user" | "assistant"; text: string }>;
    };
    const text = (body.text ?? "").trim();
    if (text.length < 1) {
      return reply.code(400).send({ error: "Пустое сообщение." });
    }
    const actor = await deps.users.findByTelegramId(auth.telegramUserId);
    if (!actor?.role) {
      return reply.code(403).send({ error: "Нет роли в штабе." });
    }
    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            (item) =>
              item &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.text === "string" &&
              item.text.trim().length > 0,
          )
          .slice(-16)
      : [];
    return deps.adminAgent.handleOsChat({
      user: actor,
      text,
      history,
      ...(body.path ? { path: body.path } : {}),
      ...(body.branchCrmId ? { branchCrmId: body.branchCrmId } : {}),
    });
  });
}

function requireRole(
  auth: Authed,
  min: StaffRole,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): boolean {
  if (!hasAtLeast(auth.role as StaffRole, min)) {
    reply.code(403).send({ error: "Недостаточно прав для этого раздела." });
    return false;
  }
  return true;
}

function requireAuth(env: AppEnv, request: FastifyRequest, reply: { code: (n: number) => { send: (b: unknown) => unknown } }): Authed | null {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    reply.code(401).send({ error: "Нужен вход." });
    return null;
  }
  const payload = verifyStaffJwt(env, token);
  if (!payload) {
    reply.code(401).send({ error: "Сессия истекла." });
    return null;
  }
  return { telegramUserId: payload.sub, role: payload.role, name: payload.name };
}

function publicUser(telegramUserId: string, role: string, name: string | null) {
  return { telegramUserId, role, name: name ?? "штаб" };
}

function clampInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.min(max, Math.floor(n));
}
