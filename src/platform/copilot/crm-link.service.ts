import type { AppEnv } from "../../config/env.js";
import type { CrmPeopleRepository } from "../crm-import/crm-data.repository.js";
import type { EscalationRepository } from "../escalation/escalation.repository.js";
import type { CrmLinkRepository } from "./crm-link.repository.js";

export class CrmLinkService {
  constructor(
    private readonly env: AppEnv,
    private readonly crmLinkDocs: CrmLinkRepository,
    private readonly crmPeople: CrmPeopleRepository,
    private readonly escalationDocs: EscalationRepository,
  ) {}

  async get(parentTelegramId: string) {
    return this.crmLinkDocs.findByTelegram(parentTelegramId);
  }

  clientUrl(studentCrmId: string | null): string | null {
    if (!studentCrmId) {
      return null;
    }
    const base = this.env.CRM_BASE_URL.replace(/\/$/, "");
    // Ведомости: карточка клиента обычно открывается с id в query.
    return `${base}/?client_id=${encodeURIComponent(studentCrmId)}`;
  }

  /** Привязать по телефону (или crmId ученика). */
  async linkByQuery(input: {
    parentTelegramId: string;
    query: string;
    actorTelegramId: string;
    parentUsername?: string | null;
    parentDisplayName?: string | null;
  }): Promise<string> {
    const q = input.query.trim();
    const digits = q.replace(/\D/g, "");
    const asCrmId = /^\d{1,12}$/.test(q.trim()) ? q.trim() : null;

    let student =
      digits.length >= 10 ? await this.crmPeople.findStudentByPhone(digits) : null;
    if (!student && asCrmId) {
      const list = await this.crmPeople.listByStatus(
        ["active", "all_active", "application", "sampler", "leave", "declined", "quarantine"],
        80,
      );
      student = list.find((s) => s.crmId === asCrmId) ?? null;
    }
    if (!student && q.length >= 3 && digits.length < 10) {
      const list = await this.crmPeople.listByStatus(
        ["active", "all_active", "application", "sampler", "leave", "declined"],
        40,
      );
      const needle = q.toLowerCase();
      student =
        list.find((s) => s.name.toLowerCase().includes(needle)) ??
        list.find((s) => (s.accountName ?? "").toLowerCase().includes(needle)) ??
        null;
    }

    const guardian = digits.length >= 10 ? await this.crmPeople.findGuardianByPhone(digits) : null;

    if (!student && !guardian) {
      return "В CRM никого не нашёл. Пришли телефон родителя (+7…) или crmId / имя ребёнка точнее.";
    }

    const link = await this.crmLinkDocs.upsert({
      parentTelegramId: input.parentTelegramId,
      parentUsername: input.parentUsername ?? null,
      parentDisplayName: input.parentDisplayName ?? null,
      phone: digits.length >= 10 ? digits.slice(-11) : student?.accountPhone ?? guardian?.phone ?? null,
      studentCrmId: student?.crmId ?? null,
      studentName: student?.name ?? null,
      guardianCrmId: guardian?.crmId ?? student?.accountCrmId ?? null,
      guardianName: guardian?.name ?? student?.accountName ?? null,
      linkedByTelegramId: input.actorTelegramId,
    });

    const url = this.clientUrl(link.studentCrmId);
    return [
      "**Привязал Telegram ↔ CRM**",
      link.studentName ? `Ученик: **${link.studentName}** (\`${link.studentCrmId}\`)` : null,
      link.guardianName ? `Родитель CRM: ${link.guardianName}` : null,
      link.phone ? `Тел: ${link.phone}` : null,
      url ? `CRM: ${url}` : `База CRM: ${this.env.CRM_BASE_URL}`,
    ]
      .filter((x): x is string => Boolean(x))
      .join("\n");
  }

  async linkFromEscalation(input: {
    escalationId: string;
    query: string;
    actorTelegramId: string;
  }): Promise<string> {
    const doc = await this.escalationDocs.findById(input.escalationId);
    if (!doc) {
      return "Дело не нашёл.";
    }
    return this.linkByQuery({
      parentTelegramId: doc.parentTelegramId,
      query: input.query,
      actorTelegramId: input.actorTelegramId,
      parentUsername: doc.parentUsername,
      parentDisplayName: doc.parentDisplayName,
    });
  }

  formatShort(link: Awaited<ReturnType<CrmLinkRepository["findByTelegram"]>>): string | null {
    if (!link) {
      return null;
    }
    const url = this.clientUrl(link.studentCrmId);
    const who = link.studentName ?? link.guardianName ?? link.phone ?? "CRM";
    return url ? `CRM: **${who}** — ${url}` : `CRM: **${who}**`;
  }
}
