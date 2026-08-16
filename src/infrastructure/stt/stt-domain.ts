import { compactLookup, matchKey, scoreTextMatch, tokensOf } from "../../platform/org/text-match.js";

const STOPWORDS = new Set([
  "в",
  "на",
  "и",
  "с",
  "по",
  "к",
  "у",
  "из",
  "для",
  "the",
  "a",
  "an",
  "to",
  "into",
  "in",
  "and",
  "please",
]);

export type SttEntity = {
  canonical: string;
  aliases: string[];
};

/** Инструкция для GigaChat Audio: только дословная транскрипция. */
export function buildGigaChatTranscribePrompt(entities: SttEntity[] = []): string {
  const names = uniqueTerms(entities.flatMap((item) => [item.canonical, ...item.aliases])).slice(0, 80);
  const namesLine =
    names.length > 0
      ? ` Если слышишь эти имена/названия — пиши их точно: ${names.join(", ")}.`
      : "";
  return (
    "Расшифруй речь из аудио дословно на русском. Верни только текст транскрипции, без кавычек, без пояснений и без markdown." +
    " Сохраняй латиницу в названиях (KolTech, не call.tech)." +
    namesLine +
    " Если речи нет — верни пустую строку."
  );
}

/**
 * Подтягивает в транскрипте только имена из каталога (чаты, филиалы, labels).
 * Обычные слова не трогает — смыслом занимается агент. Без regex-словарей фраз.
 */
export function alignTranscriptToEntities(raw: string, entities: SttEntity[]): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 2 || entities.length === 0) {
    return text;
  }

  const catalog = entities
    .map((item) => ({
      canonical: item.canonical.trim(),
      aliases: uniqueTerms([item.canonical, ...item.aliases]).filter((alias) => compactLookup(alias).length >= 3),
    }))
    .filter((item) => item.canonical.length > 0 && item.aliases.length > 0)
    .sort((a, b) => compactLookup(b.canonical).length - compactLookup(a.canonical).length);

  const tokens = text.split(" ");
  const used = new Array<boolean>(tokens.length).fill(false);
  const out = tokens.slice();

  for (let size = Math.min(4, tokens.length); size >= 1; size -= 1) {
    for (let i = 0; i <= tokens.length - size; i += 1) {
      if (rangeUsed(used, i, size)) {
        continue;
      }
      const spanTokens = tokens.slice(i, i + size);
      const content = spanTokens
        .map((token, offset) => ({ token, offset }))
        .filter((item) => !isStop(item.token));
      if (content.length === 0) {
        continue;
      }
      const span = content.map((item) => item.token).join(" ");
      const hit = bestEntity(span, catalog);
      if (!hit) {
        continue;
      }
      let placed = false;
      for (const item of content) {
        const at = i + item.offset;
        out[at] = placed ? "" : hit;
        placed = true;
        used[at] = true;
      }
    }
  }

  return out.filter((part) => part.length > 0).join(" ").replace(/\s+([,.!?])/g, "$1").trim();
}

function isStop(token: string): boolean {
  const norm = token.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "");
  return norm.length === 0 || STOPWORDS.has(norm);
}

function bestEntity(span: string, catalog: Array<{ canonical: string; aliases: string[] }>): string | null {
  let best: { canonical: string; score: number } | null = null;
  const spanCompact = compactLookup(span);
  if (spanCompact.length < 3) {
    return null;
  }
  const spanContentCount = tokensOf(span).filter((token) => !STOPWORDS.has(token)).length;
  for (const item of catalog) {
    for (const alias of item.aliases) {
      const aliasCompact = compactLookup(alias);
      if (aliasCompact.length < 3) {
        continue;
      }
      const spanKey = matchKey(span);
      const aliasKey = matchKey(alias);
      const canonicalKey = matchKey(item.canonical);
      if (spanKey === aliasKey || spanKey === canonicalKey) {
        return item.canonical;
      }
      const aliasContentCount = Math.max(1, tokensOf(alias).filter((token) => !STOPWORDS.has(token)).length);
      const keyScore = Math.max(similarity(spanKey, aliasKey), similarity(spanKey, canonicalKey));
      if (spanContentCount > aliasContentCount && keyScore < 0.9) {
        continue;
      }
      const score = Math.max(
        scoreTextMatch(span, alias),
        scoreTextMatch(span, item.canonical),
        similarity(spanCompact, aliasCompact),
        similarity(spanCompact, compactLookup(item.canonical)),
        keyScore,
      );
      const minScore = spanCompact.length <= 5 ? 0.9 : 0.76;
      if (score < minScore) {
        continue;
      }
      if (!best || score > best.score) {
        best = { canonical: item.canonical, score };
      }
    }
  }
  return best?.canonical ?? null;
}

function similarity(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.72) {
    return 0.88;
  }
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  const ratio = 1 - distance / maxLen;
  if (distance <= 2 && Math.min(a.length, b.length) >= 5) {
    return Math.max(ratio, 0.86);
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

function uniqueTerms(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed.length < 2) {
      continue;
    }
    const key = compactLookup(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function rangeUsed(used: boolean[], start: number, size: number): boolean {
  for (let i = start; i < start + size; i += 1) {
    if (used[i]) {
      return true;
    }
  }
  return false;
}
