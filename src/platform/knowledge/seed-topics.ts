import type { KnowledgeService } from "./knowledge.service.js";
import type { KnowledgeRepository } from "./knowledge.repository.js";

const STARTER: Array<{ title: string; body: string }> = [
  {
    title: "Первая тренировка",
    body: "Перед первым: в зале есть скамейки, можно ждать в коридоре, есть вода и туалет. Ребёнка не ставят в угол, если с первого раза не вышло.",
  },
  {
    title: "Отмена тренировки",
    body: "Если тренировка отменяется, пишем коротко: филиал, группа, дата, причина если уместно, и когда следующее занятие. Без паники и без лишней воды.",
  },
  {
    title: "Расписание и опоздания",
    body: "Имеет смысл напомнить, во сколько начинается группа и что лучше приходить за 5–10 минут. Если ребёнок болеет — предупредить тренера заранее.",
  },
];

export async function seedStarterTopics(docs: KnowledgeRepository, knowledge: KnowledgeService): Promise<void> {
  const existing = await docs.searchStructured({ kind: "topic" });
  if (existing.length > 0) {
    return;
  }
  for (const topic of STARTER) {
    await knowledge.upsert({
      title: topic.title,
      body: topic.body,
      kind: "topic",
      namespace: "parents",
      actorTelegramId: "system",
    });
  }
}
