import { AccessDeniedError, NotFoundError } from "../shared/errors.js";
import type { AppEnv } from "../../config/env.js";
import { parseBootstrapTelegramIds } from "../../config/env.js";
import type { AuditRepository } from "./audit.repository.js";
import type { UserRepository } from "./user.repository.js";
import { matchesMasterRecovery } from "./master-recovery.js";
import { MASTER_KOLOTUSHIN, hasAtLeast, type StaffRole, type StaffUser } from "./types.js";

export class StaffService {
  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditRepository,
    private readonly env: AppEnv,
  ) {}

  async bootstrapFromEnv(): Promise<void> {
    const ids = parseBootstrapTelegramIds(this.env.BOOTSTRAP_TELEGRAM_IDS);
    for (const [index, telegramUserId] of ids.entries()) {
      const existing = await this.users.findByTelegramId(telegramUserId);
      if (existing) {
        continue;
      }
      await this.users.upsertStaff({
        telegramUserId,
        username: null,
        displayName: index === 0 ? MASTER_KOLOTUSHIN : null,
        role: "superadmin",
        status: "active",
        isOwner: index === 0,
      });
      await this.audit.record(telegramUserId, "bootstrap_superadmin", { owner: index === 0 });
    }
    await this.ensureMaster();
  }

  async ensureMaster(): Promise<void> {
    const owner = await this.users.findOwner();
    if (!owner) {
      return;
    }
    if (owner.isOwner && owner.honorific === MASTER_KOLOTUSHIN) {
      return;
    }
    await this.users.markAsMaster(owner.telegramUserId);
  }

  isMasterRecovery(text: string): boolean {
    return matchesMasterRecovery(text, this.env.MASTER_RECOVERY_PHRASE);
  }

  async recoverMaster(
    telegramUserId: string,
    username: string | null,
    displayName: string | null,
  ): Promise<StaffUser> {
    await this.users.clearOwnerExcept(telegramUserId);
    await this.users.upsertStaff({
      telegramUserId,
      username,
      displayName: MASTER_KOLOTUSHIN,
      role: "superadmin",
      status: "active",
      isOwner: true,
      honorific: MASTER_KOLOTUSHIN,
      actorKind: "owner",
    });
    const user = await this.users.markAsMaster(telegramUserId);
    if (!user) {
      throw new NotFoundError("Не смог вернуть доступ Мастера.");
    }
    await this.audit.record(telegramUserId, "master_recovery", {});
    return user;
  }

  async resolveStaff(telegramUserId: string, username: string | null, displayName: string | null): Promise<StaffUser | null> {
    await this.maybeBootstrapSelf(telegramUserId, username, displayName);
    const user = await this.users.findByTelegramId(telegramUserId);
    if (!user || user.status !== "active" || !user.role) {
      await this.users.rememberVisitor(telegramUserId, username, displayName);
      return null;
    }
    await this.users.touchProfile(telegramUserId, username, displayName);
    return this.users.findByTelegramId(telegramUserId);
  }

  async assignRole(actor: StaffUser, target: { telegramUserId?: string; username?: string }, role: StaffRole): Promise<StaffUser> {
    if (!actor.role || !hasAtLeast(actor.role, "superadmin")) {
      throw new AccessDeniedError("Назначать роли может только суперадмин.");
    }
    const telegramUserId = await this.resolveTargetId(target);
    const existing = await this.users.findByTelegramId(telegramUserId);
    if (existing?.isOwner) {
      throw new AccessDeniedError("Роль Мастера Колотушина так не меняют.");
    }
    const updated = await this.users.upsertStaff({
      telegramUserId,
      username: target.username ?? existing?.username ?? null,
      displayName: existing?.displayName ?? null,
      role,
      status: "active",
    });
    await this.audit.record(actor.telegramUserId, "assign_role", { telegramUserId, role });
    return updated;
  }

  async revoke(actor: StaffUser, target: { telegramUserId?: string; username?: string }): Promise<void> {
    if (!actor.role || !hasAtLeast(actor.role, "superadmin")) {
      throw new AccessDeniedError("Снимать доступ может только суперадмин.");
    }
    const telegramUserId = await this.resolveTargetId(target);
    if (telegramUserId === actor.telegramUserId) {
      throw new AccessDeniedError("Себе доступ так не забирают.");
    }
    const targetUser = await this.users.findByTelegramId(telegramUserId);
    if (targetUser?.isOwner) {
      throw new AccessDeniedError("У Мастера Колотушина доступ не забирают.");
    }
    const staff = await this.users.listStaff();
    const remainingSupers = staff.filter(
      (person) => person.role === "superadmin" && person.telegramUserId !== telegramUserId,
    );
    if (remainingSupers.length === 0) {
      throw new AccessDeniedError("Последнего суперадмина снять нельзя.");
    }
    const ok = await this.users.revoke(telegramUserId);
    if (!ok) {
      throw new NotFoundError("Такого человека в штате нет.");
    }
    await this.audit.record(actor.telegramUserId, "revoke_role", { telegramUserId });
  }

  async listDesk(): Promise<StaffUser[]> {
    const people = await this.users.listStaff();
    return people.filter((person) => person.role === "admin" || person.role === "superadmin");
  }

  async listSuperadmins(): Promise<StaffUser[]> {
    const people = await this.users.listStaff();
    return people.filter((person) => person.role === "superadmin");
  }

  async listStaff(actor: StaffUser): Promise<StaffUser[]> {
    if (!actor.role || !hasAtLeast(actor.role, "superadmin")) {
      throw new AccessDeniedError();
    }
    return this.users.listStaff();
  }

  async listVisitors(actor: StaffUser): Promise<StaffUser[]> {
    if (!actor.role || !hasAtLeast(actor.role, "superadmin")) {
      throw new AccessDeniedError();
    }
    return this.users.listVisitors();
  }

  async getUserForStaff(actor: StaffUser, telegramUserId: string): Promise<StaffUser | null> {
    if (!actor.role || !hasAtLeast(actor.role, "superadmin")) {
      throw new AccessDeniedError();
    }
    return this.users.findByTelegramId(telegramUserId);
  }

  private async resolveTargetId(target: { telegramUserId?: string; username?: string }): Promise<string> {
    if (target.telegramUserId) {
      return target.telegramUserId;
    }
    if (target.username) {
      const found = await this.users.findByUsername(target.username);
      if (found) {
        return found.telegramUserId;
      }
      throw new NotFoundError(`Не знаю @${target.username.replace(/^@/, "")}. Пусть человек сначала напишет боту, либо дай его telegram id.`);
    }
    throw new NotFoundError("Нужен username или telegram id.");
  }

  private async maybeBootstrapSelf(
    telegramUserId: string,
    username: string | null,
    displayName: string | null,
  ): Promise<void> {
    const ids = parseBootstrapTelegramIds(this.env.BOOTSTRAP_TELEGRAM_IDS);
    if (!ids.includes(telegramUserId)) {
      return;
    }
    const existing = await this.users.findByTelegramId(telegramUserId);
    if (existing) {
      return;
    }
    await this.users.upsertStaff({
      telegramUserId,
      username,
      displayName: ids[0] === telegramUserId ? MASTER_KOLOTUSHIN : displayName,
      role: "superadmin",
      status: "active",
      isOwner: ids[0] === telegramUserId,
    });
    await this.audit.record(telegramUserId, "bootstrap_superadmin", { onMessage: true });
  }
}
