import type { KnowledgeService } from "./knowledge.service.js";
import type { KnowledgeRepository } from "./knowledge.repository.js";
import type { KnowledgeKind, KnowledgeNamespace } from "./types.js";

const DOCS: Array<{ title: string; kind: KnowledgeKind; namespace: KnowledgeNamespace; body: string }> = [
  {
    title: "Мастер Колотушин",
    kind: "faq",
    namespace: "internal",
    body: `Мастер Колотушин — Михаил Геннадьевич Колотушин, разработчик Грифон OS / Грифон Админ, руководитель KolTech. Чёрный пояс, первый дан.

Когда говорит с ним самим: тепло и коротко, без резюме и без формулировок вроде «вы не владелец». Если спросил «кто я» — две живые фразы и к делу.

Полный доступ: суперадмин, штат, база, рассылки. Обращение «Мастер Колотушин» уместно, но не как штамп в каждом предложении.`,
  },
  {
    title: "Михаил Геннадьевич Колотушин — профиль",
    kind: "policy",
    namespace: "internal",
    body: `Михаил Геннадьевич Колотушин — российский ИТ-специалист, фулстек-веб-разработчик (Fullstack Web Developer) и фрилансер. Связан с Владивостоком / Приморским краем.

Специализация: сайты и интернет-магазины «под ключ», вёрстка, JavaScript, веб-программирование.

Предпринимательство: руководитель ИТ-проекта KolTech. Ранее ИП Колотушин М. Г. (Приморский край, разработка ПО; деятельность прекращена в марте 2024). Формат работы: удалёнка, фриланс, ИТ-консалтинг.

Публичные следы:
- GitHub: KolotushinTechnologies, компания KolTech, сайт koltech.dev
- vc.ru: fullstack, основатель социальной сети Lettera
- Zoon: фрилансер, программист и верстальщик, Владивосток
- KolTech: кастомная веб/мобильная разработка, AI, системная аналитика

В контексте Грифон OS он — автор и разработчик платформы, первый человек в системе, Мастер Колотушин.`,
  },
];

export async function seedMasterProfile(docs: KnowledgeRepository, knowledge: KnowledgeService): Promise<void> {
  for (const item of DOCS) {
    const found = (await docs.searchStructured({ query: item.title, kind: item.kind })).find(
      (doc) => doc.title === item.title,
    );
    if (found) {
      continue;
    }
    await knowledge.upsert({
      title: item.title,
      body: item.body,
      kind: item.kind,
      namespace: item.namespace,
      actorTelegramId: "system",
    });
  }
}
