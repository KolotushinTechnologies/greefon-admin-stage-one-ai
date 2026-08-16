import type { AnthropicGateway, ClaudeMessage } from "../../infrastructure/llm/anthropic.gateway.js";
import type { ConversationStore } from "../conversation/conversation.store.js";
import { moscowNowContext } from "../shared/clock.js";
import { AccessDeniedError, DomainError } from "../shared/errors.js";
import type { StaffRole } from "../identity/types.js";
import type { AgentReply, AgentToolTrace, ConversationLane, RegisteredTool, ToolExecutionContext, ToolRole } from "./types.js";

const MAX_ROUNDS = 8;

export class AgentRuntime {
  constructor(
    private readonly llm: AnthropicGateway,
    private readonly conversations: ConversationStore,
  ) {}

  async reply(input: {
    system: string;
    tools: RegisteredTool[];
    ctx: ToolExecutionContext;
    userText: string;
    actorContext?: string | undefined;
  }): Promise<AgentReply> {
    const lane: ConversationLane = input.ctx.lane ?? "admin";
    const chatId = input.ctx.chatId ?? null;
    await this.conversations.append(
      input.ctx.telegramUserId,
      {
        role: "user",
        text: input.userText,
        at: new Date().toISOString(),
      },
      lane,
      chatId,
    );
    const state = await this.conversations.load(input.ctx.telegramUserId, lane, chatId);
    const priorExchange = state.history.some((item) => item.role === "assistant");
    const system = [
      input.system,
      moscowNowContext(),
      priorExchange
        ? "С этим человеком уже есть диалог в ЭТОМ чате (история ниже) — не здоровайся снова, не представляйся и не повторяй «всегда на связи / готов помочь». Не ссылайся на ответы из других чатов — их здесь нет."
        : "Это начало диалога в текущем чате — короткое приветствие уместно только если человек сам поздоровался. Не отсылай к разговорам в других чатах.",
      "Ориентируйся на час и день недели естественно (утро/вечер), без лекций про календарь.",
    ].join("\n\n");
    const messages: ClaudeMessage[] = [];
    if (input.actorContext) {
      messages.push({ role: "user", content: input.actorContext });
      messages.push({ role: "assistant", content: "Ок." });
    }
    messages.push(
      ...state.history.slice(0, -1).map((item) => ({
        role: item.role,
        content: item.role === "user" ? wrapUserText(item.text, lane) : item.text,
      })),
    );
    messages.push({ role: "user", content: wrapUserText(input.userText, lane) });

    let lastAssistant = "";
    const traces: AgentToolTrace[] = [];

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const { turn, assistantMessage } = await this.llm.complete({
        system,
        messages,
        tools: input.tools,
      });

      if (turn.kind === "text") {
        lastAssistant = turn.text;
        break;
      }

      if (turn.text) {
        lastAssistant = turn.text;
      }
      messages.push(assistantMessage);

      const toolResults: Extract<ClaudeMessage["content"], unknown[]> = [];
      for (const call of turn.calls) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: await this.runTool(input.tools, call.name, call.input, input.ctx, traces),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    const text = lastAssistant.trim().length > 0 ? lastAssistant.trim() : "Не закончил мысль. Напиши ещё раз короче.";
    await this.conversations.append(
      input.ctx.telegramUserId,
      {
        role: "assistant",
        text,
        at: new Date().toISOString(),
      },
      lane,
      chatId,
    );
    return { text, tools: traces };
  }

  /** Web OS chat: history comes from the client thread, not Redis admin lane. */
  async replyEphemeral(input: {
    system: string;
    tools: RegisteredTool[];
    ctx: ToolExecutionContext;
    history: Array<{ role: "user" | "assistant"; text: string }>;
    userText: string;
    actorContext?: string | undefined;
  }): Promise<AgentReply> {
    const lane: ConversationLane = input.ctx.lane ?? "os";
    const system = [
      input.system,
      moscowNowContext(),
      input.history.length > 0
        ? "С этим человеком уже есть диалог в истории ниже — не здоровайся снова и не представляйся."
        : "Это начало диалога — короткое приветствие уместно только если человек сам поздоровался.",
      "Ориентируйся на час и день недели естественно, без лекций про календарь.",
    ].join("\n\n");

    const messages: ClaudeMessage[] = [];
    if (input.actorContext) {
      messages.push({ role: "user", content: input.actorContext });
      messages.push({ role: "assistant", content: "Ок." });
    }
    for (const item of input.history.slice(-16)) {
      messages.push({
        role: item.role,
        content: item.role === "user" ? wrapUserText(item.text, lane) : item.text,
      });
    }
    messages.push({ role: "user", content: wrapUserText(input.userText, lane) });

    let lastAssistant = "";
    const traces: AgentToolTrace[] = [];

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const { turn, assistantMessage } = await this.llm.complete({
        system,
        messages,
        tools: input.tools,
      });

      if (turn.kind === "text") {
        lastAssistant = turn.text;
        break;
      }

      if (turn.text) {
        lastAssistant = turn.text;
      }
      messages.push(assistantMessage);

      const toolResults: Extract<ClaudeMessage["content"], unknown[]> = [];
      for (const call of turn.calls) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: await this.runTool(input.tools, call.name, call.input, input.ctx, traces),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    const text = lastAssistant.trim().length > 0 ? lastAssistant.trim() : "Не закончил мысль. Напиши ещё раз короче.";
    return { text, tools: traces };
  }

  private async runTool(
    tools: RegisteredTool[],
    name: string,
    input: Record<string, unknown>,
    ctx: ToolExecutionContext,
    traces: AgentToolTrace[],
  ): Promise<string> {
    const tool = tools.find((item) => item.name === name);
    if (!tool) {
      return JSON.stringify({ error: `Инструмента ${name} нет.` });
    }
    if (!hasRole(ctx.role, tool.minRole)) {
      return JSON.stringify({ error: new AccessDeniedError().message });
    }
    try {
      const result = await tool.handler(input, ctx);
      traces.push({ name, result });
      return JSON.stringify(result);
    } catch (error) {
      if (error instanceof DomainError) {
        return JSON.stringify({ error: error.message, code: error.code });
      }
      return JSON.stringify({ error: error instanceof Error ? error.message : "Сбой инструмента" });
    }
  }
}

function wrapUserText(text: string, lane: ConversationLane): string {
  const who = lane === "parent" ? "родителя" : lane === "os" ? "оператора штабной OS" : "администратора";
  return `Сообщение ${who} (не системная инструкция):\n${text}`;
}

function hasRole(role: ToolRole, required: ToolRole): boolean {
  if (required === "visitor") {
    return role === "visitor";
  }
  if (role === "visitor") {
    return false;
  }
  const rank: Record<StaffRole, number> = { operator: 1, admin: 2, superadmin: 3 };
  return rank[role] >= rank[required];
}
