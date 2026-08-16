import type { KnowledgeService } from "../knowledge/knowledge.service.js";
import type { ChatRepository } from "../org/chat.repository.js";
import { matchKey, scoreTextMatch, tokensOf } from "../org/text-match.js";

export type GroundingLane = "person" | "branch" | "schedule" | "chat" | "topic" | "faq";

export type GroundingEntity = {
  lane: GroundingLane;
  id: string;
  title: string;
  aliases: string[];
  hint: string;
};

export type GroundingHit = {
  span: string;
  lane: GroundingLane;
  title: string;
  id: string;
  score: number;
  ask: string;
  hint: string;
};

const STOP = new Set([
  "и",
  "в",
  "на",
  "с",
  "по",
  "к",
  "у",
  "из",
  "для",
  "что",
  "это",
  "как",
  "или",
  "то",
  "же",
  "бы",
  "не",
  "да",
  "нет",
  "там",
  "тут",
  "ещё",
  "еще",
  "уже",
  "будет",
  "было",
  "есть",
  "надо",
  "нужно",
  "можно",
  "пожалуйста",
  "также",
  "анонс",
  "объявление",
  "напиши",
  "написать",
  "отправь",
  "тренировка",
  "тренировки",
  "первая",
  "вторая",
  "третья",
  "сезон",
  "старт",
  "начинается",
  "родительское",
  "собрание",
  "группа",
  "чат",
  "филиал",
  "зал",
]);

/**
 * Умное наведение по Базе Знаний / чатам после STT или кривой формулировки:
 * ищем похожие сущности и даём агенту готовые варианты для переспроса.
 */
export class KnowledgeGroundingService {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly chats: ChatRepository,
  ) {}

  async catalog(): Promise<GroundingEntity[]> {
    const [staff, branches, schedules, topics, chats] = await Promise.all([
      this.knowledge.listStaffProfiles(),
      this.knowledge.listBranchCards(),
      this.knowledge.listScheduleCards(),
      this.knowledge.listActive({ kind: "topic" }),
      this.chats.listAll(),
    ]);
    const out: GroundingEntity[] = [];
    for (const doc of staff) {
      out.push({
        lane: "person",
        id: doc._id,
        title: doc.title,
        aliases: aliasesFromTitle(doc.title),
        hint: "тренер / руководитель из Базы Знаний",
      });
    }
    for (const doc of branches) {
      out.push({
        lane: "branch",
        id: doc._id,
        title: doc.title,
        aliases: aliasesFromTitle(doc.title),
        hint: "филиал / зал",
      });
    }
    for (const doc of schedules) {
      out.push({
        lane: "schedule",
        id: doc._id,
        title: doc.title,
        aliases: aliasesFromTitle(doc.title),
        hint: "группа / расписание",
      });
    }
    for (const doc of topics) {
      out.push({
        lane: "topic",
        id: doc._id,
        title: doc.title,
        aliases: [doc.title],
        hint: "тема для общения",
      });
    }
    for (const chat of chats) {
      out.push({
        lane: "chat",
        id: chat.telegramChatId,
        title: chat.title,
        aliases: [chat.title, ...chat.labels],
        hint: "рабочий чат Telegram",
      });
    }
    return out;
  }

  /** Имена для STT prompt / align. */
  async speechEntities(): Promise<Array<{ canonical: string; aliases: string[] }>> {
    const catalog = await this.catalog();
    return catalog
      .filter((item) => item.lane === "person" || item.lane === "branch" || item.lane === "chat")
      .map((item) => ({ canonical: item.title, aliases: item.aliases }));
  }

  async suggest(text: string, limit = 6): Promise<GroundingHit[]> {
    const catalog = await this.catalog();
    const spans = extractSpans(text);
    const hits: GroundingHit[] = [];
    const used = new Set<string>();

    for (const span of spans) {
      const ranked = catalog
        .map((entity) => {
          const score = Math.max(
            ...entity.aliases.map((alias) => scoreTextMatch(alias, span)),
            scoreTextMatch(entity.title, span),
            similarityKeys(matchKey(span), matchKey(entity.title)),
            ...entity.aliases.map((alias) => similarityKeys(matchKey(span), matchKey(alias))),
          );
          return { entity, score };
        })
        .filter((item) => item.score >= 0.72)
        .filter((item) => !isWeakSecondaryTokenHit(span, item.entity.title))
        .sort(
          (a, b) =>
            b.score - a.score ||
            lanePriority(b.entity.lane) - lanePriority(a.entity.lane) ||
            a.entity.title.length - b.entity.title.length,
        );

      const top = ranked[0];
      if (!top) {
        continue;
      }
      const key = `${top.entity.lane}:${top.entity.id}`;
      if (used.has(key)) {
        continue;
      }
      // Уже почти точное совпадение с каноном — не шумим.
      if (matchKey(span) === matchKey(top.entity.title) && top.score >= 0.95) {
        continue;
      }
      used.add(key);
      hits.push({
        span,
        lane: top.entity.lane,
        title: top.entity.title,
        id: top.entity.id,
        score: top.score,
        hint: top.entity.hint,
        ask: askFor(top.entity.lane, top.entity.title, span),
      });
    }

    // Длинные/точные совпадения важнее общих отчеств.
    return hits
      .sort((a, b) => b.score - a.score || b.span.length - a.span.length)
      .slice(0, limit);
  }

  formatForAgent(text: string, hits: GroundingHit[]): string {
    if (hits.length === 0) {
      return text;
    }
    const lines = hits.map(
      (hit, index) =>
        `${index + 1}. «${hit.span}» → [${hit.lane}] **${hit.title}** (${hit.hint}, ${(hit.score * 100).toFixed(0)}%): ${hit.ask}`,
    );
    return [
      text,
      "",
      "[подсказки Базы Знаний]",
      "Распознавание могло исказить имена/названия. Опирайся на Базу: при сомнении переспроси одним сообщением с готовым вариантом ниже. Не угадывай втихую.",
      ...lines,
    ].join("\n");
  }
}

function askFor(lane: GroundingLane, title: string, span: string): string {
  switch (lane) {
    case "person":
      return `Имеешь в виду **${title}** (вместо «${span}»)?`;
    case "branch":
      return `Зал/филиал — **${title}**?`;
    case "schedule":
      return `Группа — **${title}**?`;
    case "chat":
      return `Чат — **${title}**?`;
    case "topic":
      return `Тема — **${title}**?`;
    default:
      return `Это **${title}**?`;
  }
}

function lanePriority(lane: GroundingLane): number {
  switch (lane) {
    case "person":
      return 5;
    case "branch":
      return 4;
    case "chat":
      return 3;
    case "schedule":
      return 2;
    case "topic":
      return 1;
    default:
      return 0;
  }
}

function aliasesFromTitle(title: string): string[] {
  const parts = title.split(/\s+/).filter(Boolean);
  const out = new Set<string>([title]);
  if (parts[0] && parts[0].length >= 4) {
    out.add(parts[0]);
  }
  if (parts.length >= 2) {
    out.add(`${parts[0]} ${parts[1]}`);
  }
  return [...out];
}

/** «николаевич» не должен притягивать любого тренера с таким отчеством. */
function isWeakSecondaryTokenHit(span: string, title: string): boolean {
  const spanTokens = tokensOf(span);
  if (spanTokens.length !== 1) {
    return false;
  }
  const titleTokens = tokensOf(title);
  if (titleTokens.length < 2) {
    return false;
  }
  const spanKey = matchKey(spanTokens[0] ?? "");
  const firstKey = matchKey(titleTokens[0] ?? "");
  if (spanKey === firstKey) {
    return false;
  }
  return titleTokens.slice(1).some((token) => matchKey(token) === spanKey);
}

function extractSpans(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const tokens = tokensOf(normalized).filter((token) => token.length >= 4 && !STOP.has(token));
  const spans: string[] = [];
  for (let size = Math.min(3, tokens.length); size >= 1; size -= 1) {
    for (let i = 0; i <= tokens.length - size; i += 1) {
      const span = tokens.slice(i, i + size).join(" ");
      if (span.length >= 4) {
        spans.push(span);
      }
    }
  }
  // Уникальные, сначала более длинные
  const seen = new Set<string>();
  return spans
    .sort((a, b) => b.length - a.length)
    .filter((span) => {
      const key = matchKey(span);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function similarityKeys(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.7) {
    return 0.88;
  }
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  const ratio = 1 - distance / maxLen;
  if (distance <= 2 && Math.min(a.length, b.length) >= 5) {
    return Math.max(ratio, 0.82);
  }
  if (distance <= 3 && Math.min(a.length, b.length) >= 6 && ratio >= 0.65) {
    return ratio;
  }
  return ratio;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (let i = 0; i < rows; i += 1) {
    matrix[i]![0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0]![j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        (matrix[i - 1]![j] ?? 0) + 1,
        (matrix[i]![j - 1] ?? 0) + 1,
        (matrix[i - 1]![j - 1] ?? 0) + cost,
      );
    }
  }
  return matrix[a.length]![b.length] ?? 0;
}
