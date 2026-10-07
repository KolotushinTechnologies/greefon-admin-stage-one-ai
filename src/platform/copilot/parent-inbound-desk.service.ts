import type { EscalationService } from "../escalation/escalation.service.js";
import type { EscalationRepository } from "../escalation/escalation.repository.js";
import type { CopilotService } from "./copilot.service.js";
import type { AiActionLogRepository } from "./ai-action-log.repository.js";
import type { InboundIntent, LeadHeat } from "./types.js";

const DESK_INTENTS = new Set<InboundIntent>([
  "new_lead",
  "payment",
  "missed_class",
  "reschedule",
  "camp",
  "conflict",
  "complaint",
  "documents",
]);

/**
 * ТЗ №1–4: после ответа родителю — если тема для стола и нет открытого дела,
 * открываем карточку админу (даже без escalate_to_staff).
 */
export class ParentInboundDeskService {
  constructor(
    private readonly copilot: CopilotService,
    private readonly escalationService: EscalationService,
    private readonly escalationDocs: EscalationRepository,
    private readonly aiActions: AiActionLogRepository,
  ) {}

  async maybeOpenDesk(input: {
    parentTelegramId: string;
    parentChatId: string;
    parentMessageId?: number | null;
    parentUsername: string | null;
    parentDisplayName: string | null;
    question: string;
  }): Promise<void> {
    const question = input.question.trim();
    if (question.length < 8) {
      return;
    }
    // Уже есть открытое дело — не плодим карточки.
    const existing = await this.escalationDocs.findOpenByParent(input.parentTelegramId);
    if (existing) {
      return;
    }

    let brief;
    try {
      brief = await this.copilot.analyzeInbound({
        question,
        reason: "inbound_auto_desk",
        parentDisplayName: input.parentDisplayName,
      });
    } catch {
      return;
    }

    if (!shouldOpenDesk(brief.intent, brief.heat, question)) {
      await this.aiActions.record({
        kind: "inbound_analyzed",
        parentTelegramId: input.parentTelegramId,
        payload: {
          intent: brief.intent,
          heat: brief.heat,
          deskOpened: false,
          reason: "not_desk_worthy",
        },
      });
      return;
    }

    await this.escalationService.open({
      parentTelegramId: input.parentTelegramId,
      parentChatId: input.parentChatId,
      parentMessageId: input.parentMessageId ?? null,
      parentUsername: input.parentUsername,
      parentDisplayName: input.parentDisplayName,
      question,
      reason: `auto_desk:${brief.intent}`,
      brief,
    });
  }
}

function shouldOpenDesk(intent: InboundIntent, heat: LeadHeat, question: string): boolean {
  if (DESK_INTENTS.has(intent)) {
    return true;
  }
  if (heat === "hot") {
    return true;
  }
  // Запасной эвристический слой, если LLM поставил other.
  const q = question.toLowerCase();
  return /запис|пробн|абонемент|сколько стоит|хотим попробовать|сыну|дочер|дочке|лагер/.test(q);
}
