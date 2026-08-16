import { z } from "zod";

export const schoolEventKindSchema = z.enum(["attestation", "competition", "camp"]);
export type SchoolEventKind = z.infer<typeof schoolEventKindSchema>;

export const schoolEventStatusSchema = z.enum(["upcoming", "closed"]);
export type SchoolEventStatus = z.infer<typeof schoolEventStatusSchema>;

export const schoolEventSchema = z.object({
  _id: z.string(),
  kind: schoolEventKindSchema,
  status: schoolEventStatusSchema,
  title: z.string(),
  dateNote: z.string(),
  place: z.string().nullable(),
  note: z.string().nullable(),
  createdByTelegramId: z.string(),
  updatedByTelegramId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type SchoolEvent = z.infer<typeof schoolEventSchema>;

export const parentRequestKindSchema = z.enum([
  "attestation",
  "competition",
  "camp",
  "personal",
  "holiday",
]);
export type ParentRequestKind = z.infer<typeof parentRequestKindSchema>;
