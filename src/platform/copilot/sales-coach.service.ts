import type { CopilotBrief, InboundIntent, LeadCard, LeadHeat, SalesStepKind } from "./types.js";

/** Помощник по продажам — следующий шаг (ТЗ №6). */
export class SalesCoachService {
  suggest(input: {
    intent: InboundIntent | string;
    heat: LeadHeat | string;
    lead: LeadCard;
    question?: string;
  }): { kind: SalesStepKind; text: string } {
    const intent = input.intent;
    const heat = input.heat;
    const lead = input.lead;
    const q = (input.question ?? "").toLowerCase();

    if (intent === "complaint" || intent === "conflict" || /жалоб|конфликт|возврат/.test(q)) {
      return {
        kind: "resolve_issue",
        text: "Сначала закрыть сервисный вопрос лично (без продаж). После разрядки — мягко вернуть к занятиям.",
      };
    }
    if (intent === "payment" || /оплат|абонемент|чек/.test(q)) {
      return {
        kind: "remind_payment",
        text: "Напомнить об оплате / прислать реквизиты и срок. Не обещать скидку без согласования.",
      };
    }
    if (intent === "new_lead" || intent === "schedule_question" || intent === "camp") {
      if (!lead.preferredBranch && lead.district) {
        return {
          kind: "offer_other_branch",
          text: `Уточнить филиал рядом с «${lead.district}» и предложить 1–2 ближайших пробных слота.`,
        };
      }
      if (heat === "hot") {
        return {
          kind: "book_trial",
          text: lead.preferredTime
            ? `Сразу предложить запись на пробное под «${lead.preferredTime}» и подтвердить присутствие.`
            : "Сразу предложить ближайшее пробное (будни/выходные) и зафиксировать запись.",
        };
      }
      if (heat === "warm") {
        return {
          kind: "book_trial",
          text: "Дожать до пробного: возраст/филиал/удобное время → один конкретный слот на выбор.",
        };
      }
      return {
        kind: "nurture",
        text: "Мягко прогреть: полезный факт по возрасту/филиалу + вопрос «когда удобнее прийти».",
      };
    }
    if (intent === "missed_class" || intent === "reschedule") {
      return {
        kind: "nurture",
        text: "Закрыть перенос/пропуск, затем предложить следующий визит, чтобы не потерять ритм.",
      };
    }
    if (heat === "hot") {
      return { kind: "call_now", text: "Горячий контакт — лучше позвонить сегодня и закрыть следующий шаг голосом." };
    }
    return {
      kind: "offer_abonnement",
      text: "Если уже ходили на пробное — предложить абонемент и ответить на возражения по цене/расписанию.",
    };
  }

  enrichBrief(brief: CopilotBrief, question?: string): CopilotBrief {
    if (brief.nextSalesStep.trim().length > 0) {
      return brief;
    }
    const step = this.suggest({
      intent: brief.intent,
      heat: brief.heat,
      lead: brief.lead,
      ...(question !== undefined ? { question } : {}),
    });
    return { ...brief, nextSalesStep: step.text };
  }
}
