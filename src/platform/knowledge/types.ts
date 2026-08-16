import { z } from "zod";

export const knowledgeNamespaceSchema = z.enum(["admin", "parents", "coaches", "sales", "internal"]);
export type KnowledgeNamespace = z.infer<typeof knowledgeNamespaceSchema>;

export const knowledgeKindSchema = z.enum([
  "policy",
  "branch",
  "group",
  "schedule",
  "topic",
  "chat_note",
  "faq",
  "event",
]);
export type KnowledgeKind = z.infer<typeof knowledgeKindSchema>;

export const knowledgeDocStatusSchema = z.enum(["active", "deleted"]);
export type KnowledgeDocStatus = z.infer<typeof knowledgeDocStatusSchema>;

export const knowledgeFieldSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});
export type KnowledgeField = z.infer<typeof knowledgeFieldSchema>;

export const knowledgeDocSchema = z.object({
  _id: z.string(),
  namespace: knowledgeNamespaceSchema,
  kind: knowledgeKindSchema,
  title: z.string(),
  body: z.string(),
  fields: z.array(knowledgeFieldSchema),
  branchId: z.string().nullable(),
  groupId: z.string().nullable(),
  status: knowledgeDocStatusSchema,
  createdByTelegramId: z.string(),
  updatedByTelegramId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type KnowledgeDoc = z.infer<typeof knowledgeDocSchema>;

export const knowledgeChunkSchema = z.object({
  _id: z.string(),
  docId: z.string(),
  namespace: knowledgeNamespaceSchema,
  ordinal: z.number().int(),
  text: z.string(),
  embedding: z.array(z.number()),
  createdAt: z.date(),
});

export type KnowledgeChunk = z.infer<typeof knowledgeChunkSchema>;

export type RetrievedChunk = {
  docId: string;
  title: string;
  text: string;
  score: number;
  namespace: KnowledgeNamespace;
  kind: KnowledgeKind;
};
