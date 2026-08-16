import type { KnowledgeService } from "../../platform/knowledge/knowledge.service.js";

export async function collectTopics(knowledge: KnowledgeService, query: string): Promise<string> {
  const found = await knowledge.lookup({ query, kind: "topic", excludeNamespaces: ["internal"] });
  if (found.structured.length === 0 && found.retrieved.length === 0) {
    return "В базе тем пока пусто. Можешь надиктовать, что обычно говорим родителям — я запомню.";
  }
  const lines = [
    ...found.structured.map((doc) => `• ${doc.title}: ${doc.body}`),
    ...found.retrieved
      .filter((chunk) => !found.structured.some((doc) => doc._id === chunk.docId))
      .map((chunk) => `• ${chunk.title}: ${chunk.text}`),
  ];
  return lines.slice(0, 8).join("\n");
}
