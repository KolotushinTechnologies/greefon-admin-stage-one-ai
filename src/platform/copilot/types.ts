import { z } from "zod";

export const inboundIntentSchema = z.enum([
  "new_lead",
  "payment",
  "missed_class",
  "reschedule",
  "schedule_question",
  "camp",
  "conflict",
  "complaint",
  "documents",
  "other",
]);
export type InboundIntent = z.infer<typeof inboundIntentSchema>;

export const leadHeatSchema = z.enum(["hot", "warm", "cold"]);
export type LeadHeat = z.infer<typeof leadHeatSchema>;

export const leadCardSchema = z.object({
  childName: z.string().nullable().default(null),
  childAge: z.number().nullable().default(null),
  district: z.string().nullable().default(null),
  experience: z.string().nullable().default(null),
  interest: z.string().nullable().default(null),
  preferredBranch: z.string().nullable().default(null),
  preferredTime: z.string().nullable().default(null),
  goal: z.string().nullable().default(null),
});
export type LeadCard = z.infer<typeof leadCardSchema>;

export type CopilotBrief = {
  intent: InboundIntent;
  heat: LeadHeat;
  heatWhy: string;
  stageLabel: string;
  lead: LeadCard;
  draftReply: string;
  adminHints: string[];
  summaryTitle: string;
  /** Следующий шаг продаж (ТЗ №6). */
  nextSalesStep: string;
};

export type SalesStepKind =
  | "book_trial"
  | "offer_abonnement"
  | "remind_payment"
  | "offer_other_branch"
  | "call_now"
  | "nurture"
  | "resolve_issue";
