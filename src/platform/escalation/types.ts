import { z } from "zod";

export const escalationStatusSchema = z.enum(["open", "claimed", "resolved", "cancelled"]);
export type EscalationStatus = z.infer<typeof escalationStatusSchema>;

/** Стадия follow-up на деле (ТЗ №5 — идеальные «дела на сегодня»). */
export const followUpKindSchema = z.enum([
  "none",
  "promised_visit",
  "await_payment",
  "after_trial",
  "nurture",
  "won",
  "lost",
]);
export type FollowUpKind = z.infer<typeof followUpKindSchema>;

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
  draftReply: z.string().nullable().default(null),
  intent: z.string().nullable().default(null),
  heat: z.string().nullable().default(null),
  /** Короткая пометка follow-up: «обещали оплатить», «после пробного» и т.п. */
  followUpNote: z.string().nullable().default(null),
  followUpKind: followUpKindSchema.default("none"),
  /** Бот уже ответил родителю (auto_desk) — «Отправить» вторичен. */
  botAlreadyReplied: z.boolean().default(false),
  notices: z.array(staffNoticeSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Escalation = z.infer<typeof escalationSchema>;

export type AttentionBucket = "urgent" | "check" | "new";

export const FOLLOW_UP_LABELS: Record<FollowUpKind, string> = {
  none: "без метки",
  promised_visit: "обещал прийти",
  await_payment: "ждём оплату",
  after_trial: "после пробного без покупки",
  nurture: "не записался — дожать",
  won: "купил / закрыто успешно",
  lost: "потерян",
};
