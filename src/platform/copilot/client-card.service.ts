import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import type { CrmGuardian, CrmPaymentRecord, CrmStudent, CrmVisitMark } from "../crm-import/types.js";
import type { EscalationRepository } from "../escalation/escalation.repository.js";
import type { LeadRepository } from "./lead.repository.js";
import type { CrmLinkService } from "./crm-link.service.js";
import type { CrmLinkRepository } from "./crm-link.repository.js";

/** Карточка клиента по команде (ТЗ №7). */
export class ClientCardService {
  constructor(
    private readonly mongo: MongoConnection,
    private readonly escalationDocs: EscalationRepository,
    private readonly leads: LeadRepository,
    private readonly crmLinks: CrmLinkService,
    private readonly crmLinkDocs: CrmLinkRepository,
  ) {}

  async lookup(queryRaw: string): Promise<string> {
    const query = normalizeQuery(queryRaw);
    if (query.length < 2) {
      return "Напиши имя точнее: `клиент Маша Петрова` или `@username`.";
    }

    const [students, guardians] = await Promise.all([
      this.searchStudents(query, 5),
      this.searchGuardians(query, 5),
    ]);

    if (students.length === 0 && guardians.length === 0) {
      const byTg = await this.lookupTelegramSide(query);
      if (byTg) {
        return byTg;
      }
      return `По запросу «${queryRaw.trim()}» в CRM никого не нашёл. Проверь написание или сначала сделай crm-import.`;
    }

    const blocks: string[] = [`**👨‍👩‍👧 Карточка по запросу:** ${queryRaw.trim()}`, ""];

    for (const student of students.slice(0, 3)) {
      blocks.push(await this.formatStudentCard(student));
      const url = this.crmLinks.clientUrl(student.crmId);
      if (url) {
        blocks.push(`Открыть в CRM: ${url}`);
      }
      const tgLink = await this.crmLinkDocs.findByStudentCrmId(student.crmId);
      if (tgLink) {
        const history = await this.escalationDocs.listByParent(tgLink.parentTelegramId, 5);
        blocks.push(
          `Telegram: ${tgLink.parentUsername ? `@${tgLink.parentUsername}` : tgLink.parentTelegramId}`,
          ...history.slice(0, 3).map((h) => `• ${h.status}: «${h.question.slice(0, 90)}»`),
        );
      }
      blocks.push("");
    }
    if (students.length === 0) {
      for (const g of guardians.slice(0, 2)) {
        const kids = await this.students()
          .find({ accountCrmId: g.crmId })
          .limit(5)
          .toArray();
        blocks.push(formatGuardian(g, kids));
        blocks.push("");
      }
    }

    const botSide = await this.lookupTelegramSide(query);
    if (botSide) {
      blocks.push("", "—", botSide);
    }

    return blocks.join("\n").trim();
  }

  private async formatStudentCard(student: CrmStudent): Promise<string> {
    const db = this.mongo.getDb();
    const [guardian, payments, visits] = await Promise.all([
      student.accountCrmId
        ? db.collection<CrmGuardian>("crm_guardians").findOne({ crmId: student.accountCrmId })
        : null,
      db
        .collection<CrmPaymentRecord>("crm_payments")
        .find({ clientCrmId: student.crmId })
        .sort({ payTs: -1 })
        .limit(5)
        .toArray(),
      db
        .collection<CrmVisitMark>("crm_visit_marks")
        .find({ clientCrmId: student.crmId })
        .sort({ updatedAt: -1 })
        .limit(5)
        .toArray(),
    ]);

    const paid = payments.filter((p) => p.paid);
    const lastPay = paid[0];
    const lines = [
      `**${student.name}** · статус \`${student.status}\``,
      student.branchName ? `Филиал: ${student.branchName}` : null,
      student.groupName ? `Группа: ${student.groupName}` : null,
      student.instructorName ? `Тренер: ${student.instructorName}` : null,
      student.lastVisit ? `Последний визит: ${student.lastVisit}` : null,
      guardian
        ? `Родитель: ${guardian.name ?? "—"}${guardian.phone ? ` · ${guardian.phone}` : ""}`
        : student.accountName
          ? `Родитель: ${student.accountName}${student.accountPhone ? ` · ${student.accountPhone}` : ""}`
          : null,
      lastPay
        ? `Оплата: ${Math.round(lastPay.amountKopecks / 100).toLocaleString("ru-RU")} ₽ (${lastPay.payTs ?? "дата?"})`
        : "Оплат в выборке нет",
      visits.length > 0
        ? `Недавние отметки: ${visits.map((v) => v.value).slice(0, 5).join(", ")}`
        : "Отметок посещений мало/нет",
      student.lastComment ? `Комментарий CRM: ${student.lastComment.slice(0, 160)}` : null,
    ];
    return lines.filter((x): x is string => Boolean(x)).join("\n");
  }

  private async lookupTelegramSide(query: string): Promise<string | null> {
    const username = query.replace(/^@/, "").toLowerCase();
    const openLead = await this.leads.listOpen(40);
    const hit =
      openLead.find((l) => (l.parentUsername ?? "").toLowerCase() === username) ??
      openLead.find((l) => (l.parentDisplayName ?? "").toLowerCase().includes(query));
    if (!hit) {
      return null;
    }
    const history = await this.escalationDocs.listByParent(hit.parentTelegramId, 5);
    return [
      `**Карточка из бота (CRM не нашёл):** ${hit.parentDisplayName ?? hit.parentUsername ?? hit.parentTelegramId}`,
      hit.parentUsername ? `Telegram: @${hit.parentUsername}` : null,
      `Стадия: ${hit.stageLabel} · температура: ${hit.heat}`,
      hit.nextSalesStep ? `След. шаг: ${hit.nextSalesStep}` : null,
      formatLead(hit.lead),
      "",
      "Последние обращения:",
      ...history.slice(0, 3).map((h) => `• ${h.status}: «${h.question.slice(0, 100)}»`),
    ]
      .filter((x): x is string => Boolean(x))
      .join("\n");
  }

  private students() {
    return this.mongo.getDb().collection<CrmStudent>("crm_students");
  }

  private async searchStudents(query: string, limit: number): Promise<CrmStudent[]> {
    const rx = escapeRegex(query);
    return this.students()
      .find({
        $or: [
          { name: { $regex: rx, $options: "i" } },
          { accountName: { $regex: rx, $options: "i" } },
          { accountPhone: { $regex: rx, $options: "i" } },
        ],
      })
      .limit(limit)
      .toArray();
  }

  private async searchGuardians(query: string, limit: number): Promise<CrmGuardian[]> {
    const rx = escapeRegex(query);
    return this.mongo
      .getDb()
      .collection<CrmGuardian>("crm_guardians")
      .find({
        $or: [
          { name: { $regex: rx, $options: "i" } },
          { addName: { $regex: rx, $options: "i" } },
          { phone: { $regex: rx, $options: "i" } },
        ],
      })
      .limit(limit)
      .toArray();
  }
}

function formatGuardian(g: CrmGuardian, kids: CrmStudent[]): string {
  return [
    `**Родитель:** ${g.name ?? "—"}`,
    g.phone ? `Тел: ${g.phone}` : null,
    g.email ? `Email: ${g.email}` : null,
    kids.length > 0 ? `Дети: ${kids.map((k) => `${k.name} (${k.status})`).join("; ")}` : "Дети в CRM не найдены",
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");
}

function formatLead(lead: {
  childName: string | null;
  childAge: number | null;
  preferredBranch: string | null;
  district: string | null;
  goal: string | null;
}): string {
  const parts = [
    lead.childName ? `ребёнок ${lead.childName}` : null,
    lead.childAge != null ? `${lead.childAge} лет` : null,
    lead.preferredBranch ?? lead.district,
    lead.goal,
  ].filter(Boolean);
  return parts.length > 0 ? `Лид: ${parts.join(", ")}` : "Лид: данных мало";
}

function normalizeQuery(raw: string): string {
  return raw
    .trim()
    .replace(/^@/, "")
    .replace(/^(клиент|карточка|карта)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
