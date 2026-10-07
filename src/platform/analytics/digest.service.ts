import type { TelegramMessenger } from "../../infrastructure/telegram/telegram.messenger.js";
import type { StaffService } from "../identity/staff.service.js";
import type { OutboundRepository } from "../messaging/outbound.repository.js";
import type { EscalationRepository } from "../escalation/escalation.repository.js";
import type { AttentionBucket, Escalation } from "../escalation/types.js";
import type { UsageMeter } from "./usage.meter.js";
import type { AiActionLogRepository } from "../copilot/ai-action-log.repository.js";
import { InlineKeyboard } from "grammy";

const HEAT_REVENUE: Record<string, number> = {
  hot: 15_000,
  warm: 8_000,
  cold: 0,
};

export class DigestService {
  constructor(
    private readonly staff: StaffService,
    private readonly messenger: TelegramMessenger,
    private readonly outbound: OutboundRepository,
    private readonly escalationDocs: EscalationRepository,
    private readonly usage: UsageMeter,
    private readonly aiActions: AiActionLogRepository,
  ) {}

  async sendEvening(): Promise<void> {
    const day = this.usage.moscowDay();
    const from = this.usage.moscowDayStart(day);
    const snap = await this.usage.snapshot(day);
    const broadcasts = await this.outbound.countSince(from);
    const open = await this.escalationDocs.countOpen();
    const unknown = await this.escalationDocs.listRecentUnknown(from, 6);
    const lines = [
      `**День ${day}**`,
      `Родители писали: **${snap.parentMessages}**`,
      `Не знал / отдал штабу: **${snap.escalations}**`,
      `Рассылок: **${broadcasts}**`,
      `Сейчас открыто заявок: **${open}**`,
    ];
    if (unknown.length > 0) {
      lines.push("", "Что не знал:");
      for (const item of unknown) {
        lines.push(`• ${item.question.slice(0, 120)}`);
      }
    }
    const text = lines.join("\n");
    const supers = await this.staff.listSuperadmins();
    for (const person of supers) {
      await this.messenger.sendText(person.telegramUserId, text);
    }
  }

  /** Центральная фича ТЗ №5: утренние дела админу. */
  async sendMorningTasks(): Promise<void> {
    const open = await this.escalationDocs.listOpen(40);
    const now = Date.now();
    const urgent: Array<{ item: Escalation; label: string }> = [];
    const check: Array<{ item: Escalation; label: string }> = [];
    const fresh: Array<{ item: Escalation; label: string }> = [];

    for (const item of open) {
      const bucket = classifyAttention(item, now);
      const label = caseLabel(item, now);
      if (bucket === "urgent") {
        urgent.push({ item, label });
      } else if (bucket === "new") {
        fresh.push({ item, label });
      } else {
        check.push({ item, label });
      }
    }

    const revenue = open.reduce((sum, item) => sum + (HEAT_REVENUE[item.heat ?? ""] ?? 0), 0);
    const header = [
      "**ГРИФОН AI — ДЕЛА НА СЕГОДНЯ**",
      "",
      `🔴 Требуют внимания — **${urgent.length}**`,
      `🟡 Нужно проверить — **${check.length}**`,
      `🟢 Новые заявки — **${fresh.length}**`,
      `💰 Потенциальная выручка — **${formatRub(revenue)}**`,
    ].join("\n");

    const desk = await this.staff.listDesk();
    if (desk.length === 0) {
      return;
    }

    await this.aiActions.record({
      kind: "morning_tasks_sent",
      actor: "system",
      payload: {
        urgent: urgent.length,
        check: check.length,
        fresh: fresh.length,
        revenue,
        open: open.length,
      },
    });

    for (const person of desk) {
      await this.messenger.sendText(person.telegramUserId, header);

      const sections: Array<{ title: string; rows: Array<{ item: Escalation; label: string }> }> = [
        { title: "🔴 Требуют внимания", rows: urgent },
        { title: "🟡 Нужно проверить", rows: check },
        { title: "🟢 Новые заявки", rows: fresh },
      ];

      for (const section of sections) {
        for (const row of section.rows.slice(0, 12)) {
          const who = displayName(row.item);
          const text = `${section.title}\n**${who}** — ${row.label}\n«${row.item.question.slice(0, 160)}»`;
          const keyboard = new InlineKeyboard()
            .text("Открыть", `e:o:${row.item._id}`)
            .text("Ответ", `e:d:${row.item._id}`)
            .text("Закрыть", `e:x:${row.item._id}`);
          await this.messenger.sendText(person.telegramUserId, text, keyboard);
        }
      }

      if (open.length === 0) {
        await this.messenger.sendText(
          person.telegramUserId,
          "Открытых дел нет — можно выдохнуть. Новые заявки прилетят сюда сами.",
        );
      }
    }
  }
}

function classifyAttention(item: Escalation, nowMs: number): AttentionBucket {
  const ageH = (nowMs - new Date(item.createdAt).getTime()) / 3_600_000;
  const idleH = (nowMs - new Date(item.updatedAt).getTime()) / 3_600_000;
  const intent = item.intent ?? "";
  const heat = item.heat ?? "";
  const note = `${item.followUpNote ?? ""} ${item.reason} ${item.question}`.toLowerCase();

  if (
    heat === "hot" ||
    intent === "conflict" ||
    intent === "complaint" ||
    idleH >= 12 ||
    ageH >= 24 ||
    /не ответил|обещали оплат|возврат|жалоб|конфликт/.test(note)
  ) {
    return "urgent";
  }
  if (ageH <= 6 && item.status === "open" && !item.claimedByTelegramId) {
    return "new";
  }
  return "check";
}

function caseLabel(item: Escalation, nowMs: number): string {
  if (item.followUpNote && item.followUpNote.trim().length > 0) {
    return item.followUpNote.trim();
  }
  const idleH = Math.max(0, Math.round((nowMs - new Date(item.updatedAt).getTime()) / 3_600_000));
  if (item.status === "open" && idleH >= 1) {
    return `не ответили ${idleH} ч`;
  }
  if (item.heat === "hot") {
    return "горячий лид";
  }
  if (item.intent === "new_lead") {
    return "новая заявка";
  }
  if (item.intent === "payment") {
    return "вопрос по оплате";
  }
  if (item.status === "claimed") {
    return "взяли, но ещё не закрыли";
  }
  return item.reason.slice(0, 80) || "нужно разобрать";
}

function displayName(item: Escalation): string {
  return item.parentDisplayName ?? (item.parentUsername ? `@${item.parentUsername}` : "родитель");
}

function formatRub(value: number): string {
  return `${value.toLocaleString("ru-RU")} ₽`;
}
