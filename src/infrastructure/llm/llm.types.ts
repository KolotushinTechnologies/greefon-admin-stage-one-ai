import type { AgentToolDefinition, LlmTurn } from "../../platform/agent-runtime/types.js";

/** Провайдер-нейтральные сообщения агентного цикла. */
export type LlmChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type LlmGateway = {
  complete(input: {
    system: string;
    messages: LlmChatMessage[];
    tools: AgentToolDefinition[];
  }): Promise<{ turn: LlmTurn; assistantMessage: LlmChatMessage }>;
};
