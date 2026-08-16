import type { StaffRole } from "../identity/types.js";

export type AgentName = "admin" | "parent";
export type ToolRole = StaffRole | "visitor";
export type ConversationLane = "admin" | "parent" | "os";

export type ToolJsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type AgentToolDefinition = {
  name: string;
  description: string;
  inputSchema: ToolJsonSchema;
  minRole: ToolRole;
};

export type ToolExecutionContext = {
  telegramUserId: string;
  username: string | null;
  displayName: string | null;
  role: ToolRole;
  lane?: ConversationLane;
  chatId?: string;
  /** Telegram message_id вопроса родителя — для reply после эскалации. */
  messageId?: number;
};

export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<unknown>;

export type RegisteredTool = AgentToolDefinition & {
  handler: ToolHandler;
};

export type LlmToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type LlmTurn =
  | { kind: "text"; text: string }
  | { kind: "tools"; text: string | null; calls: LlmToolCall[] };

export type AgentToolTrace = {
  name: string;
  result: unknown;
};

export type AgentReply = {
  text: string;
  tools: AgentToolTrace[];
};
