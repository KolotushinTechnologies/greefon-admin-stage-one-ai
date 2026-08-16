import type { TelegramMessenger } from "../../infrastructure/telegram/telegram.messenger.js";
import type { StaffService } from "../identity/staff.service.js";
import type { OutboundRepository } from "../messaging/outbound.repository.js";
import type { EscalationRepository } from "../escalation/escalation.repository.js";
import type { UsageMeter } from "./usage.meter.js";

export class DigestService {
  constructor(
    private readonly staff: StaffService,
    private readonly messenger: TelegramMessenger,
    private readonly outbound: OutboundRepository,
    private readonly escalationDocs: EscalationRepository,
    private readonly usage: UsageMeter,
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
}
