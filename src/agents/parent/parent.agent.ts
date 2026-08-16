import { PARENT_SYSTEM_PROMPT } from "./prompt.js";
import { buildParentTools } from "./tools.js";
import type { ParentHints, ParentHintReply } from "./parent.hints.js";
import type { AgentRuntime } from "../../platform/agent-runtime/agent.runtime.js";
import type { AgentToolTrace } from "../../platform/agent-runtime/types.js";
import type { KnowledgeService } from "../../platform/knowledge/knowledge.service.js";
import type { ScheduleService } from "../../platform/org/schedule.service.js";
import type { EscalationService } from "../../platform/escalation/escalation.service.js";
import type { SchoolEventService } from "../../platform/events/event.service.js";
import type { UsageMeter } from "../../platform/analytics/usage.meter.js";

export class ParentAgent {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly knowledge: KnowledgeService,
    private readonly schedule: ScheduleService,
    private readonly escalationService: EscalationService,
    private readonly schoolEvents: SchoolEventService,
    private readonly usage: UsageMeter,
    private readonly parentHints: ParentHints,
  ) {}

  async handlePrivateText(input: {
    telegramUserId: string;
    username: string | null;
    displayName: string | null;
    text: string;
    chatId?: string;
    messageId?: number;
    /** Reply на объявление / недавние рассылки в группе. */
    messageContext?: string;
  }): Promise<ParentHintReply> {
    await this.usage.bump("parent_message");
    const ctx: {
      telegramUserId: string;
      username: string | null;
      displayName: string | null;
      role: "visitor";
      lane: "parent";
      chatId?: string;
      messageId?: number;
    } = {
      telegramUserId: input.telegramUserId,
      username: input.username,
      displayName: input.displayName,
      role: "visitor",
      lane: "parent",
    };
    if (input.chatId) {
      ctx.chatId = input.chatId;
    }
    if (input.messageId !== undefined) {
      ctx.messageId = input.messageId;
    }
    const who = input.displayName ?? (input.username ? `@${input.username}` : null);
    const contextBits = [
      who ? ["Собеседник этого хода:", `имя: ${who}`, "тон: по-человечески, без самопрезентаций"].join("\n") : null,
      input.messageContext
        ? ["Контекст объявления / сообщения в чате (это не База Знаний, но для «это/когда» — главный источник):", input.messageContext].join(
            "\n",
          )
        : null,
    ].filter(Boolean);
    const reply = await this.runtime.reply({
      system: PARENT_SYSTEM_PROMPT,
      tools: buildParentTools({
        knowledge: this.knowledge,
        schedule: this.schedule,
        escalationService: this.escalationService,
        schoolEvents: this.schoolEvents,
      }),
      ctx,
      userText: input.text,
      ...(contextBits.length > 0 ? { actorContext: contextBits.join("\n\n") } : {}),
    });
    const next: ParentHintReply = { text: reply.text };
    const roster = rosterFromTools(reply.tools);
    if (roster) {
      next.text = roster;
    }
    const inline = this.parentHints.fromTools(reply.tools);
    if (inline) {
      next.inline = inline;
    }
    return next;
  }
}

function rosterFromTools(tools: AgentToolTrace[]): string | null {
  const used = new Set(tools.map((item) => item.name));
  // Список состава — только если не искали конкретную карточку.
  if (!used.has("list_instructors") || used.has("search_school")) {
    return null;
  }
  for (const item of [...tools].reverse()) {
    if (item.name !== "list_instructors" || !item.result || typeof item.result !== "object") {
      continue;
    }
    const message = (item.result as { parent_message?: unknown }).parent_message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }
  return null;
}
