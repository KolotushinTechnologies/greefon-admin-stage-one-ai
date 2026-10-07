import { randomUUID } from "node:crypto";
import type { AppEnv } from "../../config/env.js";
import type { AgentToolDefinition, LlmTurn } from "../../platform/agent-runtime/types.js";
import { GigaChatClient } from "../stt/gigachat.client.js";
import type { LlmChatMessage, LlmGateway } from "./llm.types.js";

/**
 * Агентный шлюз GigaChat (function calling).
 * @see https://developers.sber.ru/docs/ru/gigachat/guides/functions/overview
 */
export class GigaChatGateway implements LlmGateway {
  private readonly client: GigaChatClient;

  constructor(env: AppEnv) {
    this.client = new GigaChatClient(env);
  }

  async complete(input: {
    system: string;
    messages: LlmChatMessage[];
    tools: AgentToolDefinition[];
  }): Promise<{ turn: LlmTurn; assistantMessage: LlmChatMessage }> {
    if (!this.client.configured) {
      throw new Error("SBER_AUTH_KEY не задан — агент без GigaChat не работает.");
    }

    const functions = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));

    const payload = await this.client.chatCompletions({
      temperature: 0.2,
      messages: toGigaMessages(input.system, input.messages),
      ...(functions.length > 0
        ? {
            functions,
            function_call: "auto",
          }
        : {}),
    });

    const choice = payload?.choices?.[0];
    const message = choice?.message ?? {};
    const text =
      typeof message.content === "string" && message.content.trim().length > 0
        ? message.content.trim()
        : "";
    const call = normalizeFunctionCall(message.function_call);
    const finish = typeof choice?.finish_reason === "string" ? choice.finish_reason : "";

    if (call && (finish === "function_call" || finish === "tool_calls" || !text || call.name)) {
      const id = randomUUID();
      const assistantMessage: LlmChatMessage = {
        role: "assistant",
        content: text.length > 0 ? text : null,
        toolCalls: [{ id, name: call.name, input: call.input }],
      };
      return {
        turn: {
          kind: "tools",
          text: text.length > 0 ? text : null,
          calls: [{ id, name: call.name, input: call.input }],
        },
        assistantMessage,
      };
    }

    return {
      turn: { kind: "text", text: text.length > 0 ? text : "…" },
      assistantMessage: { role: "assistant", content: text.length > 0 ? text : "…" },
    };
  }
}

function toGigaMessages(system: string, messages: LlmChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (system.trim().length > 0) {
    out.push({ role: "system", content: system });
  }
  for (const item of messages) {
    if (item.role === "tool") {
      out.push({
        role: "function",
        name: item.name,
        content: item.content,
      });
      continue;
    }
    if (item.role === "assistant" && "toolCalls" in item && item.toolCalls.length > 0) {
      const first = item.toolCalls[0]!;
      out.push({
        role: "assistant",
        content: item.content ?? "",
        function_call: {
          name: first.name,
          arguments: first.input,
        },
      });
      continue;
    }
    out.push({
      role: item.role,
      content: "content" in item && typeof item.content === "string" ? item.content : "",
    });
  }
  return out;
}

function normalizeFunctionCall(
  raw: unknown,
): { name: string; input: Record<string, unknown> } | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as { name?: unknown; arguments?: unknown };
  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    return null;
  }
  return { name: obj.name, input: parseArguments(obj.arguments) };
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { raw };
    }
  }
  return {};
}
