import type { TelegramMessenger } from "../../infrastructure/telegram/telegram.messenger.js";
import type { StaffService } from "../identity/staff.service.js";
import type { OutboundRepository } from "../messaging/outbound.repository.js";
import type { EscalationRepository } from "../escalation/escalation.repository.js";
import type { UsageMeter } from "./usage.meter.js";
import type { AiActionLogRepository } from "../copilot/ai-action-log.repository.js";
import type { ProblemRadarService } from "../copilot/problem-radar.service.js";
import type { CrmPeopleRepository, CrmOpsRepository } from "../crm-import/crm-data.repository.js";

/** Ежедневный отчёт руководителю/админу (ТЗ №9). */
export class DailyReportService {
  constructor(
    private readonly staff: StaffService,
    private readonly messenger: TelegramMessenger,
    private readonly outbound: OutboundRepository,
    private readonly escalationDocs: EscalationRepository,
    private readonly usage: UsageMeter,
    private readonly aiActions: AiActionLogRepository,
    private readonly problemRadar: ProblemRadarService,
    private readonly crmPeople: CrmPeopleRepository,
    private readonly crmOps: CrmOpsRepository,
  ) {}

  async build(day = this.usage.moscowDay()): Promise<string> {
    const from = this.usage.moscowDayStart(day);
    const snap = await this.usage.snapshot(day);
    const [
      broadcasts,
      openTasks,
      newLeadsBot,
      resolvedToday,
      cancelledToday,
      problemHits,
      applications,
      samplers,
      declined,
      visits,
      payments,
    ] = await Promise.all([
      this.outbound.countSince(from),
      this.escalationDocs.countOpen(),
      this.escalationDocs.countIntentSince(from, ["new_lead"]),
      this.escalationDocs.countByStatusSince(from, ["resolved"]),
      this.escalationDocs.countByStatusSince(from, ["cancelled"]),
      this.problemRadar.scan(50),
      this.crmPeople.countStudentsTouchedSince(from, ["application"]).catch(() => 0),
      this.crmPeople.countStudentsTouchedSince(from, ["sampler"]).catch(() => 0),
      this.crmPeople.countStudentsTouchedSince(from, ["declined", "leave"]).catch(() => 0),
      this.crmOps.countVisitMarksSince(from).catch(() => 0),
      this.crmOps.sumPaidSince(from).catch(() => ({ count: 0, amountKopecks: 0 })),
    ]);

    const unpaidOpen = await this.crmOps.countUnpaid().catch(() => 0);

    // Воронка: бот и CRM раздельно, чтобы не склеивать разные источники в одну цифру.
    const signedUp = samplers;
    const came = visits;
    const bought = payments.count;
    const lost = declined + cancelledToday;
    const revenueRub = Math.round(payments.amountKopecks / 100);
    const problems = problemHits.length;

    const lines = [
      `**📊 ГРИФОН — ОТЧЁТ ЗА ${day}**`,
      "",
      "**Воронка (день)**",
      `🟢 Новые заявки в боте (intent) → **${newLeadsBot}**`,
      `🟢 CRM application (touched) → **${applications}**`,
      `📝 Записались CRM sampler → **${signedUp}**`,
      `👟 Пришли (отметки CRM) → **${came}**`,
      `💳 Купили (оплаты CRM) → **${bought}**`,
      `⚪ Потеряны CRM (declined/leave) + отменённые дела → **${lost}**`,
      "",
      "**Деньги**",
      `Оплат за день: **${bought}** на **${formatRub(revenueRub)}**`,
      `Неоплаченных счетов сейчас: **${unpaidOpen}**`,
      "",
      "**Работа администратора**",
      `Родители писали: **${snap.parentMessages}**`,
      `Эскалаций / карточек на стол: **${snap.escalations}**`,
      `Закрыто ответом: **${resolvedToday}**`,
      `Рассылок: **${broadcasts}**`,
      `Открытых дел сейчас: **${openTasks}**`,
      `🚨 Сигналов радара: **${problems}**`,
    ];

    if (problems > 0) {
      const top = summarizeRadar(problemHits.slice(0, 8));
      lines.push("", "**Проблемы (топ)**", ...top);
    }

    lines.push(
      "",
      "_CRM-цифры — по synced/updated за сутки после импорта. Бот и CRM не суммируем в одну «заявку»._",
    );
    return lines.join("\n");
  }

  async sendDailyReport(): Promise<void> {
    const text = await this.build();
    const desk = await this.staff.listDesk();
    const supers = await this.staff.listSuperadmins();
    const recipients = uniqueIds([...desk.map((p) => p.telegramUserId), ...supers.map((p) => p.telegramUserId)]);

    await this.aiActions.record({
      kind: "daily_report_sent",
      actor: "system",
      payload: { day: this.usage.moscowDay(), recipients: recipients.length },
    });

    for (const chatId of recipients) {
      await this.messenger.sendText(chatId, text);
    }
  }
}

function formatRub(value: number): string {
  return `${value.toLocaleString("ru-RU")} ₽`;
}

function summarizeRadar(hits: Array<{ label: string }>): string[] {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    counts.set(hit.label, (counts.get(hit.label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, n]) => `• ${label}: ${n}`);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}
