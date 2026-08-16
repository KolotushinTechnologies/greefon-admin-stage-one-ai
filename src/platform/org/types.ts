import { z } from "zod";

export const branchStatusSchema = z.enum(["active", "closed"]);
export type BranchStatus = z.infer<typeof branchStatusSchema>;

export const weekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof weekdaySchema>;

export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const branchSchema = z.object({
  _id: z.string(),
  crmId: z.string(),
  name: z.string(),
  status: branchStatusSchema,
  aliases: z.array(z.string()),
  comment: z.string().nullable(),
  syncedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Branch = z.infer<typeof branchSchema>;

export const instructorSchema = z.object({
  _id: z.string(),
  crmId: z.string(),
  name: z.string(),
  comment: z.string().nullable(),
  syncedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Instructor = z.infer<typeof instructorSchema>;

export const groupSchema = z.object({
  _id: z.string(),
  crmId: z.string(),
  branchId: z.string(),
  instructorId: z.string().nullable(),
  name: z.string(),
  timeNote: z.string().nullable(),
  weekdays: z.array(weekdaySchema),
  potential: z.number().nullable(),
  comment: z.string().nullable(),
  syncedAt: z.date(),
  localOverride: z
    .object({
      timeNote: z.string().nullable().optional(),
      weekdays: z.array(weekdaySchema).optional(),
      note: z.string().nullable().optional(),
      updatedAt: z.date(),
      updatedByTelegramId: z.string(),
    })
    .nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TrainingGroup = z.infer<typeof groupSchema>;

export const chatAudienceSchema = z.enum(["parents", "coaches", "staff", "mixed", "unknown"]);
export type ChatAudience = z.infer<typeof chatAudienceSchema>;

export const chatCategorySchema = z.enum(["branch", "group", "coaches", "staff", "announcements", "other"]);
export type ChatCategory = z.infer<typeof chatCategorySchema>;

export const botMembershipSchema = z.enum(["member", "admin", "left", "kicked", "unknown"]);
export type BotMembership = z.infer<typeof botMembershipSchema>;

export const chatRecordSchema = z.object({
  _id: z.string(),
  telegramChatId: z.string(),
  title: z.string(),
  telegramType: z.string(),
  branchId: z.string().nullable(),
  groupId: z.string().nullable(),
  audience: chatAudienceSchema,
  category: chatCategorySchema,
  labels: z.array(z.string()),
  botStatus: botMembershipSchema,
  labeledAt: z.date().nullable(),
  labeledByTelegramId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ChatRecord = z.infer<typeof chatRecordSchema>;

export function maskToWeekdays(mask: string): Weekday[] {
  const bits = mask.split(",").map((item) => item.trim());
  return WEEKDAYS.filter((_, index) => bits[index] === "1");
}

export function isClosedBranchName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("закрыто") || normalized.startsWith("я(") || normalized.startsWith("я (");
}
