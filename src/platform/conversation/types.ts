import { z } from "zod";

export const pendingIntentKindSchema = z.enum(["send_message", "update_schedule", "label_chat", "none"]);
export type PendingIntentKind = z.infer<typeof pendingIntentKindSchema>;

export const outboundMediaSchema = z.object({
  kind: z.enum(["photo", "video", "document"]),
  fileId: z.string().min(1),
});

export type OutboundMedia = z.infer<typeof outboundMediaSchema>;

export const pendingSendSchema = z.object({
  kind: z.literal("send_message"),
  confirmationId: z.string(),
  text: z.string(),
  chatIds: z.array(z.string()),
  labels: z.array(z.string()),
  media: z.array(outboundMediaSchema).default([]),
  createdAt: z.string(),
});

export type PendingSend = z.infer<typeof pendingSendSchema>;

export const pendingMediaDraftSchema = z.object({
  media: z.array(outboundMediaSchema).min(1),
  caption: z.string().nullable(),
  updatedAt: z.string(),
});

export type PendingMediaDraft = z.infer<typeof pendingMediaDraftSchema>;

export const conversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  at: z.string(),
});

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const pendingUiSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assign_role"), role: z.enum(["admin", "superadmin", "operator"]) }),
  z.object({ kind: z.literal("revoke_role") }),
  z.object({ kind: z.literal("broadcast_text") }),
  z.object({ kind: z.literal("broadcast_group"), groupId: z.string() }),
  z.object({ kind: z.literal("broadcast_chat"), chatId: z.string() }),
  z.object({ kind: z.literal("broadcast_branch"), branchId: z.string() }),
  z.object({ kind: z.literal("edit_schedule"), groupId: z.string() }),
  z.object({ kind: z.literal("escalate_answer"), escalationId: z.string() }),
  z.object({
    kind: z.literal("kb_field"),
    docId: z.string(),
    fieldIndex: z.number().int().nullable(),
  }),
  z.object({ kind: z.literal("event_add") }),
  z.object({ kind: z.literal("client_lookup") }),
  z.object({ kind: z.literal("crm_link"), escalationId: z.string() }),
]);

export type PendingUi = z.infer<typeof pendingUiSchema>;

export const conversationStateSchema = z.object({
  actorTelegramId: z.string(),
  history: z.array(conversationMessageSchema),
  pendingSend: pendingSendSchema.nullable(),
  pendingUi: pendingUiSchema.nullable(),
  updatedAt: z.string(),
});

export type ConversationState = z.infer<typeof conversationStateSchema>;
