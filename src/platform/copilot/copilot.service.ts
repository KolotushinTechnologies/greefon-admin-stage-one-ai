import type { LlmGateway } from "../../infrastructure/llm/llm.types.js";
import type { KnowledgeService } from "../knowledge/knowledge.service.js";
import {
  inboundIntentSchema,
  leadHeatSchema,
  leadCardSchema,
  type CopilotBrief,
  type InboundIntent,
  type LeadCard,
  type LeadHeat,
} from "./types.js";

const ANALYZE_SYSTEM = `Ты AI-напарник администратора школы тхэквондо «Грифон».
По сообщению родителя верни СТРОГО один JSON-объект без markdown и без пояснений вне JSON.

Поля:
{
  "intent": "new_lead|payment|missed_class|reschedule|schedule_question|camp|conflict|complaint|documents|other",
  "heat": "hot|warm|cold",
  "heatWhy": "кратко почему",
  "stageLabel": "короткая стадия, напр. новый лид / ждёт цену / конфликт",
  "summaryTitle": "короткий заголовок карточки ЗАГЛАВНЫМИ или с эмодзи, напр. НОВАЯ ЗАЯВКА",
  "lead": {
    "childName": string|null,
    "childAge": number|null,
    "district": string|null,
    "experience": string|null,
    "interest": string|null,
    "preferredBranch": string|null,
    "preferredTime": string|null,
    "goal": string|null
  },
  "draftReply": "готовый вежливый ответ родителю в стиле Грифона, без скидок и обещаний вне регламента",
  "adminHints": ["подсказка админу 1", "..."]
}

Правила:
- Не обещай скидки, возвраты, отмены занятий.
- Если данных нет — null / пустые подсказки.
- draftReply на «вы», тёплый, конкретный, с уточняющим вопросом если нужно.
- heat: hot = готов записаться/платить/срочно; warm = интерес есть, нужна работа; cold = общий вопрос или слабый интерес.`;

export class CopilotService {
  constructor(
    private readonly llm: LlmGateway,
    private readonly knowledge: KnowledgeService,
  ) {}

  async analyzeInbound(input: {
    question: string;
    reason?: string;
    parentDisplayName?: string | null;
  }): Promise<CopilotBrief> {
    const kbBits = await this.knowledgeHints(input.question);
    const userPayload = [
      `Сообщение родителя: ${input.question}`,
      input.reason ? `Контекст эскалации: ${input.reason}` : null,
      input.parentDisplayName ? `Имя в Telegram: ${input.parentDisplayName}` : null,
      kbBits ? `Фрагменты базы знаний:\n${kbBits}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const { turn } = await this.llm.complete({
        system: ANALYZE_SYSTEM,
        messages: [{ role: "user", content: userPayload }],
        tools: [],
      });
      if (turn.kind === "text") {
        const parsed = parseBriefJson(turn.text);
        if (parsed) {
          return parsed;
        }
      }
    } catch {
      // fallback ниже
    }
    return fallbackBrief(input.question);
  }

  formatAdminCard(input: {
    who: string;
    question: string;
    brief: CopilotBrief;
  }): string {
    const heatIcon = input.brief.heat === "hot" ? "🔥" : input.brief.heat === "warm" ? "🟡" : "⚪";
    const leadLines = formatLeadLines(input.brief.lead);
    const hints =
      input.brief.adminHints.length > 0
        ? ["", "Подсказки:", ...input.brief.adminHints.map((h) => `• ${h}`)].join("\n")
        : "";
    return [
      `${heatIcon} **${input.brief.summaryTitle}**`,
      input.who,
      `Намерение: ${intentLabel(input.brief.intent)}`,
      `Стадия: ${input.brief.stageLabel}`,
      `Температура: ${heatIcon} ${heatLabel(input.brief.heat)} — ${input.brief.heatWhy}`,
      "",
      "«" + input.question + "»",
      "",
      ...leadLines,
      "",
      "Предлагаемый ответ:",
      input.brief.draftReply,
      hints,
    ]
      .filter((line) => line !== null)
      .join("\n");
  }

  private async knowledgeHints(question: string): Promise<string | null> {
    try {
      const { structured, retrieved } = await this.knowledge.lookup({
        query: question,
        namespace: "parents",
      });
      const lines: string[] = [];
      for (const doc of structured.slice(0, 2)) {
        lines.push(`• ${doc.title}: ${(doc.body ?? "").slice(0, 220)}`);
      }
      for (const chunk of retrieved.slice(0, 2)) {
        lines.push(`• ${chunk.title}: ${chunk.text.slice(0, 220)}`);
      }
      return lines.length > 0 ? lines.join("\n") : null;
    } catch {
      return null;
    }
  }
}

function parseBriefJson(raw: string): CopilotBrief | null {
  const json = extractJsonObject(raw);
  if (!json) {
    return null;
  }
  try {
    const intent = inboundIntentSchema.catch("other").parse(json.intent);
    const heat = leadHeatSchema.catch("warm").parse(json.heat);
    const lead = leadCardSchema.parse(json.lead ?? {});
    const draftReply =
      typeof json.draftReply === "string" && json.draftReply.trim().length > 0
        ? json.draftReply.trim()
        : "Здравствуйте! Спасибо за сообщение. Уточните, пожалуйста, филиал и удобное время — подберём вариант.";
    return {
      intent,
      heat,
      heatWhy: typeof json.heatWhy === "string" ? json.heatWhy : "оценка по тексту",
      stageLabel: typeof json.stageLabel === "string" ? json.stageLabel : "обращение",
      summaryTitle: typeof json.summaryTitle === "string" ? json.summaryTitle : "ОБРАЩЕНИЕ",
      lead,
      draftReply,
      adminHints: Array.isArray(json.adminHints)
        ? json.adminHints.filter((item): item is string => typeof item === "string").slice(0, 5)
        : [],
    };
  } catch {
    return null;
  }
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fallbackBrief(question: string): CopilotBrief {
  return {
    intent: "other",
    heat: "warm",
    heatWhy: "не удалось разобрать автоматически",
    stageLabel: "нужен человек",
    summaryTitle: "ОБРАЩЕНИЕ",
    lead: emptyLead(),
    draftReply:
      "Здравствуйте! Спасибо за сообщение. Передал коллегам — скоро вернёмся с точным ответом. Если удобно, напишите филиал и возраст ребёнка.",
    adminHints: ["AI не разобрал сообщение — ответьте вручную"],
  };
}

function emptyLead(): LeadCard {
  return {
    childName: null,
    childAge: null,
    district: null,
    experience: null,
    interest: null,
    preferredBranch: null,
    preferredTime: null,
    goal: null,
  };
}

function formatLeadLines(lead: LeadCard): string[] {
  const rows: Array<[string, string | number | null]> = [
    ["Ребёнок", lead.childName],
    ["Возраст", lead.childAge],
    ["Район", lead.district],
    ["Филиал", lead.preferredBranch],
    ["Опыт", lead.experience],
    ["Интерес", lead.interest],
    ["Время", lead.preferredTime],
    ["Цель", lead.goal],
  ];
  const lines = rows
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim().length > 0)
    .map(([label, value]) => `${label}: ${value}`);
  return lines.length > 0 ? lines : ["Карточка лида: данных в сообщении мало"];
}

function intentLabel(intent: InboundIntent): string {
  const map: Record<InboundIntent, string> = {
    new_lead: "новая заявка",
    payment: "оплата",
    missed_class: "пропуск",
    reschedule: "перенос",
    schedule_question: "расписание",
    camp: "лагерь",
    conflict: "конфликт",
    complaint: "жалоба",
    documents: "документы",
    other: "другое",
  };
  return map[intent];
}

function heatLabel(heat: LeadHeat): string {
  if (heat === "hot") return "горячая";
  if (heat === "warm") return "требует работы";
  return "холодная";
}
