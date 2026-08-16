import Anthropic from "@anthropic-ai/sdk";
import type { AppEnv } from "../../config/env.js";
import type { AgentToolDefinition, LlmTurn } from "../../platform/agent-runtime/types.js";

export type ClaudeMessage = Anthropic.MessageParam;

export class AnthropicGateway {
  private readonly client: Anthropic;

  constructor(private readonly env: AppEnv) {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async complete(input: {
    system: string;
    messages: ClaudeMessage[];
    tools: AgentToolDefinition[];
  }): Promise<{ turn: LlmTurn; assistantMessage: ClaudeMessage }> {
    const tools = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: input.system,
      ...(tools.length > 0 ? { tools } : {}),
      messages: input.messages,
    });

    const textParts: string[] = [];
    const calls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim().length > 0) {
        textParts.push(block.text);
      }
      if (block.type === "tool_use") {
        calls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    const text = textParts.join("\n").trim();
    const assistantMessage: ClaudeMessage = { role: "assistant", content: response.content };
    if (calls.length > 0) {
      return { turn: { kind: "tools", text: text.length > 0 ? text : null, calls }, assistantMessage };
    }
    return { turn: { kind: "text", text }, assistantMessage };
  }
}
