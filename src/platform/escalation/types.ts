import { z } from "zod";

export const escalationStatusSchema = z.enum(["open", "claimed", "resolved", "cancelled"]);
export type EscalationStatus = z.infer<typeof escalationStatusSchema>;

export const staffNoticeSchema = z.object({
  chatId: z.string(),
  messageId: z.number(),
});

export const escalationSchema = z.object({
  _id: z.string(),
  status: escalationStatusSchema,
  parentTelegramId: z.string(),
  parentChatId: z.string(),
  parentMessageId: z.number().nullable().default(null),
  parentUsername: z.string().nullable(),
  parentDisplayName: z.string().nullable(),
  question: z.string(),
  reason: z.string(),
  claimedByTelegramId: z.string().nullable(),
  answer: z.string().nullable(),
  notices: z.array(staffNoticeSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Escalation = z.infer<typeof escalationSchema>;
