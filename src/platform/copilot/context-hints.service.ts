import type { EscalationRepository } from "../escalation/escalation.repository.js";
import type { Escalation } from "../escalation/types.js";
import type { CrmPeopleRepository, CrmOpsRepository } from "../crm-import/crm-data.repository.js";
import type { LeadRepository } from "./lead.repository.js";

/** Подсказки админу перед ответом (ТЗ №8). */
export class ContextHintsService {
  constructor(
    private readonly escalationDocs: EscalationRepository,
    private readonly leads: LeadRepository,
    private readonly crmPeople: CrmPeopleRepository,
    private readonly crmOps: CrmOpsRepository,
  ) {}

  async forEscalation(doc: Escalation): Promise<string[]> {
    const hints: string[] = [];
    const history = await this.escalationDocs.listByParent(doc.parentTelegramId, 12);
    const prior = history.filter((item) => item._id !== doc._id);

    if (prior.length > 0) {
      const last = prior[0]!;
      const days = daysBetween(last.createdAt, new Date());
      if (days === 0) {
        hints.push("Этот родитель уже писал сегодня — смотри историю обращений.");
      } else if (days === 1) {
        hints.push("Родитель писал вчера.");
      } else if (days <= 14) {
        hints.push(`Родитель уже обращался ${days} дн. назад: «${clip(last.question, 90)}».`);
      } else {
        hints.push(`Были обращения раньше (последнее ~${days} дн. назад).`);
      }

      const similar = prior.find((item) => similarQuestion(item.question, doc.question));
      if (similar) {
        const ago = daysBetween(similar.createdAt, new Date());
        hints.push(
          similar.answer
            ? `Похожий вопрос ${ago} дн. назад — уже отвечали: «${clip(similar.answer, 100)}».`
            : `Похожий вопрос ${ago} дн. назад ещё без ответа / закрыт без текста.`,
        );
      }

      const openTwin = prior.find((item) => item.status === "open" || item.status === "claimed");
      if (openTwin) {
        hints.push("У этого родителя уже есть другое открытое дело — не дублируй ответы.");
      }

      const promised = prior.find((item) =>
        /перезвон|обеща|оплат|пробн|прийти|запиш/.test(
          `${item.followUpNote ?? ""} ${item.reason} ${item.answer ?? ""} ${item.question}`,
        ),
      );
      if (promised) {
        hints.push(
          `Ранее звучало обязательство/договорённость: «${clip(promised.followUpNote ?? promised.answer ?? promised.reason, 100)}».`,
        );
      }
    }

    const lead = await this.leads.findByParent(doc.parentTelegramId);
    if (lead?.nextSalesStep) {
      hints.push(`След. шаг продаж: ${lead.nextSalesStep}`);
    }
    if (lead?.lead.preferredBranch || lead?.lead.childAge != null) {
      const bits = [
        lead.lead.childName ? `ребёнок ${lead.lead.childName}` : null,
        lead.lead.childAge != null ? `${lead.lead.childAge} лет` : null,
        lead.lead.preferredBranch ?? lead.lead.district,
      ].filter(Boolean);
      if (bits.length > 0) {
        hints.push(`Карточка лида: ${bits.join(", ")}.`);
      }
    }

    const crmHints = await this.crmHints(doc, lead?.lead.childName ?? null);
    hints.push(...crmHints);

    if (doc.heat === "hot") {
      hints.push("Горячий лид — лучше ответить быстро и предложить конкретный слот.");
    }
    if (doc.intent === "complaint" || doc.intent === "conflict") {
      hints.push("Чувствительная тема (жалоба/конфликт) — без скидок и обещаний в чате, сначала человек.");
    }
    if (doc.intent === "payment") {
      hints.push("Тема оплаты — не называй суммы и скидки без сверки с регламентом/CRM.");
    }
    if (doc.followUpNote) {
      hints.push(`Заметка по делу: ${doc.followUpNote}`);
    }

    const idleH = Math.max(0, Math.round((Date.now() - new Date(doc.updatedAt).getTime()) / 3_600_000));
    if (idleH >= 12) {
      hints.push(`Без движения уже ~${idleH} ч — родитель может быть раздражён ожиданием.`);
    }

    return unique(hints).slice(0, 8);
  }

  private async crmHints(doc: Escalation, childName: string | null): Promise<string[]> {
    const out: string[] = [];
    try {
      let student = null;
      if (childName && childName.trim().length >= 2) {
        const list = await this.crmPeople.listByStatus(
          ["active", "all_active", "application", "sampler", "leave", "declined"],
          40,
        );
        const needle = childName.trim().toLowerCase();
        student = list.find((s) => s.name.toLowerCase().includes(needle)) ?? null;
      }
      if (!student && doc.parentDisplayName) {
        const list = await this.crmPeople.listByStatus(["application", "sampler", "active", "all_active"], 30);
        const needle = doc.parentDisplayName.trim().toLowerCase();
        student =
          list.find(
            (s) =>
              (s.accountName ?? "").toLowerCase().includes(needle) ||
              s.name.toLowerCase().includes(needle),
          ) ?? null;
      }
      if (!student) {
        return out;
      }
      out.push(
        `CRM: **${student.name}** · статус \`${student.status}\`${student.branchName ? ` · ${student.branchName}` : ""}.`,
      );
      if (student.status === "sampler") {
        out.push("В CRM — пробный (sampler): после ответа мягко закрыть на абонемент.");
      }
      if (student.status === "application") {
        out.push("В CRM — заявка (application): дожать запись на пробное.");
      }
      if (student.lastVisit) {
        out.push(`Последний визит в CRM: ${student.lastVisit}.`);
      }
      if (student.crmId) {
        const pay = await this.crmOps.findLatestPaymentForClient(student.crmId);
        if (pay && !pay.paid && pay.amountKopecks > 0) {
          out.push(
            `У клиента неоплаченный счёт ~${Math.round(pay.amountKopecks / 100).toLocaleString("ru-RU")} ₽ — абонемент/оплата под риском.`,
          );
        } else if (pay?.paid && pay.month) {
          out.push(`Последняя оплата CRM: месяц ${pay.month}.`);
        }
      }
    } catch {
      // CRM опционален
    }
    return out;
  }

  formatBlock(hints: string[]): string {
    if (hints.length === 0) {
      return "";
    }
    return ["", "🧠 **Подсказки**", ...hints.map((h) => `• ${h}`)].join("\n");
  }
}

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function similarQuestion(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length < 12 || nb.length < 12) {
    return false;
  }
  if (na === nb) {
    return true;
  }
  const wa = new Set(na.split(" ").filter((w) => w.length > 3));
  const wb = nb.split(" ").filter((w) => w.length > 3);
  if (wa.size === 0 || wb.length === 0) {
    return false;
  }
  let hit = 0;
  for (const w of wb) {
    if (wa.has(w)) {
      hit += 1;
    }
  }
  return hit / Math.max(wb.length, 1) >= 0.55;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, max: number): string {
  const t = value.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 1)}…`;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}
