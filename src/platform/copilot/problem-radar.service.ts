import type { EscalationRepository } from "../escalation/escalation.repository.js";
import type { Escalation } from "../escalation/types.js";
import type { StaffService } from "../identity/staff.service.js";
import type { TelegramMessenger } from "../../infrastructure/telegram/telegram.messenger.js";
import type { AiActionLogRepository } from "./ai-action-log.repository.js";
import type { UsageMeter } from "../analytics/usage.meter.js";
import { InlineKeyboard } from "grammy";

export type RadarKind =
  | "complaint"
  | "conflict"
  | "refund"
  | "trainer"
  | "repeat"
  | "payment_overdue"
  | "negativity"
  | "stale";

export type RadarHit = {
  kind: RadarKind;
  label: string;
  escalation: Escalation;
};

/** Радар проблем (ТЗ №10). */
export class ProblemRadarService {
  constructor(
    private readonly escalationDocs: EscalationRepository,
    private readonly staff: StaffService,
    private readonly messenger: TelegramMessenger,
    private readonly aiActions: AiActionLogRepository,
    private readonly usage: UsageMeter,
  ) {}

  async scan(limit = 30): Promise<RadarHit[]> {
    const open = await this.escalationDocs.listOpen(60);
    const from = new Date(Date.now() - 14 * 86_400_000);
    const recent = await this.escalationDocs.listSince(from, 100);
    const hits: RadarHit[] = [];

    for (const item of open) {
      hits.push(...detectOnCase(item));
    }

    // Повторяющиеся вопросы по одному родителю за 14 дней
    const byParent = new Map<string, Escalation[]>();
    for (const item of recent) {
      const list = byParent.get(item.parentTelegramId) ?? [];
      list.push(item);
      byParent.set(item.parentTelegramId, list);
    }
    for (const list of byParent.values()) {
      if (list.length < 2) {
        continue;
      }
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i]!;
          const b = list[j]!;
          if (tokenOverlap(a.question, b.question) >= 0.5) {
            const pick = a.status === "open" || a.status === "claimed" ? a : b;
            if (pick.status === "open" || pick.status === "claimed") {
              hits.push({
                kind: "repeat",
                label: "Повторяющийся вопрос",
                escalation: pick,
              });
            }
          }
        }
      }
    }

    return dedupeHits(hits).slice(0, limit);
  }

  async sendRadar(): Promise<void> {
    const hits = await this.scan(24);
    const desk = await this.staff.listDesk();
    if (desk.length === 0) {
      return;
    }

    await this.aiActions.record({
      kind: "problem_radar_sent",
      actor: "system",
      payload: {
        count: hits.length,
        kinds: hits.reduce<Record<string, number>>((acc, hit) => {
          acc[hit.kind] = (acc[hit.kind] ?? 0) + 1;
          return acc;
        }, {}),
        day: this.usage.moscowDay(),
      },
    });

    if (hits.length === 0) {
      for (const person of desk) {
        await this.messenger.sendText(
          person.telegramUserId,
          "**🚨 Радар проблем**\n\nСейчас явных красных зон нет. Держим курс.",
        );
      }
      return;
    }

    const summary = [
      "**🚨 Радар проблем**",
      `Найдено сигналов: **${hits.length}**`,
      "",
      ...summarizeKinds(hits),
    ].join("\n");

    for (const person of desk) {
      await this.messenger.sendText(person.telegramUserId, summary);
      for (const hit of hits.slice(0, 15)) {
        const who =
          hit.escalation.parentDisplayName ??
          (hit.escalation.parentUsername ? `@${hit.escalation.parentUsername}` : "родитель");
        const text = [
          `🚨 **${hit.label}**`,
          who,
          `«${hit.escalation.question.slice(0, 160)}»`,
        ].join("\n");
        const keyboard = new InlineKeyboard()
          .text("Открыть", `e:o:${hit.escalation._id}`)
          .text("Ответ", `e:d:${hit.escalation._id}`)
          .text("Закрыть", `e:x:${hit.escalation._id}`);
        await this.messenger.sendText(person.telegramUserId, text, keyboard);
      }
    }
  }
}

function detectOnCase(item: Escalation): RadarHit[] {
  const blob = `${item.intent ?? ""} ${item.reason} ${item.question} ${item.followUpNote ?? ""}`.toLowerCase();
  const hits: RadarHit[] = [];
  const idleH = (Date.now() - new Date(item.updatedAt).getTime()) / 3_600_000;

  if (item.intent === "complaint" || /жалоб|претенз|недовольн/.test(blob)) {
    hits.push({ kind: "complaint", label: "Жалоба / недовольство", escalation: item });
  }
  if (item.intent === "conflict" || /конфликт|угрож|суд|прокуратур/.test(blob)) {
    hits.push({ kind: "conflict", label: "Конфликт", escalation: item });
  }
  if (/возврат|верните деньг|refund/.test(blob)) {
    hits.push({ kind: "refund", label: "Возврат / деньги", escalation: item });
  }
  if (/тренер|инструктор|смишл|обидел|кричит|хамит/.test(blob) && /жалоб|недоволь|плохо|ужас/.test(blob)) {
    hits.push({ kind: "trainer", label: "Недовольство тренером", escalation: item });
  }
  if (item.intent === "payment" && (/просроч|долг|не оплат|задолж/.test(blob) || idleH >= 24)) {
    hits.push({ kind: "payment_overdue", label: "Оплата под риском", escalation: item });
  }
  if (/безобрази|кошмар|ужас|развод|увольн|обман/.test(blob)) {
    hits.push({ kind: "negativity", label: "Сильный негатив", escalation: item });
  }
  if (idleH >= 18 && (item.heat === "hot" || item.intent === "complaint" || item.intent === "conflict")) {
    hits.push({ kind: "stale", label: "Горит без ответа", escalation: item });
  }
  return hits;
}

function tokenOverlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) {
    return 0;
  }
  const set = new Set(ta);
  let hit = 0;
  for (const t of tb) {
    if (set.has(t)) {
      hit += 1;
    }
  }
  return hit / Math.max(tb.length, 1);
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

function dedupeHits(hits: RadarHit[]): RadarHit[] {
  const seen = new Set<string>();
  const out: RadarHit[] = [];
  for (const hit of hits) {
    const key = `${hit.kind}:${hit.escalation._id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(hit);
  }
  const rank: Record<RadarKind, number> = {
    conflict: 1,
    complaint: 2,
    refund: 3,
    negativity: 4,
    trainer: 5,
    payment_overdue: 6,
    stale: 7,
    repeat: 8,
  };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

function summarizeKinds(hits: RadarHit[]): string[] {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    counts.set(hit.label, (counts.get(hit.label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, n]) => `• ${label}: ${n}`);
}
