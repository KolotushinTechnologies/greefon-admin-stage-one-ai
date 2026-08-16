import { z } from "zod";

export const noteStatusSchema = z.enum(["active", "archived"]);
export type NoteStatus = z.infer<typeof noteStatusSchema>;

export const superadminNoteSchema = z.object({
  _id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string()),
  status: noteStatusSchema,
  createdByTelegramId: z.string().min(1),
  updatedByTelegramId: z.string().min(1),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type SuperadminNote = z.infer<typeof superadminNoteSchema>;
