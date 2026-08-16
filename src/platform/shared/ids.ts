import { brandValue, type Brand } from "./brand.js";

export type TelegramUserId = Brand<string, "TelegramUserId">;
export type TelegramChatId = Brand<string, "TelegramChatId">;
export type UserId = Brand<string, "UserId">;
export type BranchId = Brand<string, "BranchId">;
export type GroupId = Brand<string, "GroupId">;
export type InstructorId = Brand<string, "InstructorId">;
export type ChatRecordId = Brand<string, "ChatRecordId">;
export type KnowledgeDocId = Brand<string, "KnowledgeDocId">;
export type ConversationId = Brand<string, "ConversationId">;
export type OutboundMessageId = Brand<string, "OutboundMessageId">;
export type CrmExternalId = Brand<string, "CrmExternalId">;

export const Ids = {
  telegramUser: (value: string | number): TelegramUserId => brandValue(String(value)),
  telegramChat: (value: string | number): TelegramChatId => brandValue(String(value)),
  user: (value: string): UserId => brandValue(value),
  branch: (value: string): BranchId => brandValue(value),
  group: (value: string): GroupId => brandValue(value),
  instructor: (value: string): InstructorId => brandValue(value),
  chatRecord: (value: string): ChatRecordId => brandValue(value),
  knowledgeDoc: (value: string): KnowledgeDocId => brandValue(value),
  conversation: (value: string): ConversationId => brandValue(value),
  outboundMessage: (value: string): OutboundMessageId => brandValue(value),
  crm: (value: string | number): CrmExternalId => brandValue(String(value)),
};
