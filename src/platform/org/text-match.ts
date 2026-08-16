export function normalizeLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactLookup(value: string): string {
  return normalizeLookup(value).replace(/\s+/g, "");
}

const RU_TO_LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/** Ключ для сравнения RU↔LAT (колтех ≈ koltech), без словарей фраз. */
export function matchKey(value: string): string {
  const compact = compactLookup(value);
  let out = "";
  for (const ch of compact) {
    out += RU_TO_LAT[ch] ?? ch;
  }
  // ASR часто слышит KolTech как «call tech».
  if (out.startsWith("call") && out.length >= 7) {
    return `kol${out.slice(4)}`;
  }
  return out;
}

export function tokensOf(value: string): string[] {
  return normalizeLookup(value).split(" ").filter((item) => item.length > 1);
}

export function scoreTextMatch(haystack: string, needle: string): number {
  const h = normalizeLookup(haystack);
  const n = normalizeLookup(needle);
  if (!n || !h) {
    return 0;
  }
  if (h === n) {
    return 1;
  }
  if (h.includes(n) && n.length / h.length >= 0.7) {
    return 0.86;
  }
  const hc = compactLookup(haystack);
  const nc = compactLookup(needle);
  if (nc.length >= 4) {
    const shorter = hc.length <= nc.length ? hc : nc;
    const longer = hc.length <= nc.length ? nc : hc;
    if (shorter.length / longer.length >= 0.7 && (hc === nc || longer.includes(shorter))) {
      return hc === nc ? 1 : 0.9;
    }
  }
  const hk = matchKey(haystack);
  const nk = matchKey(needle);
  if (nk.length >= 4) {
    const shorter = hk.length <= nk.length ? hk : nk;
    const longer = hk.length <= nk.length ? nk : hk;
    if (hk === nk) {
      return 1;
    }
    if (shorter.length / longer.length >= 0.7 && longer.includes(shorter)) {
      return 0.9;
    }
  }
  if (hk.length >= 5 && nk.length >= 5) {
    const distance = levenshteinKeys(hk, nk);
    const maxLen = Math.max(hk.length, nk.length);
    const ratio = 1 - distance / maxLen;
    if (distance <= 2 && ratio >= 0.7) {
      return Math.max(0.84, ratio);
    }
  }
  const needleTokens = tokensOf(n);
  const hayTokens = [...tokensOf(h)];
  if (needleTokens.length === 0) {
    return 0;
  }
  const hit = needleTokens.filter((token) =>
    hayTokens.some((item) => {
      if (item === token || matchKey(item) === matchKey(token)) {
        return true;
      }
      const a = matchKey(item);
      const b = matchKey(token);
      const shorter = a.length <= b.length ? a : b;
      const longer = a.length <= b.length ? b : a;
      return shorter.length >= 4 && shorter.length / longer.length >= 0.7 && longer.includes(shorter);
    }),
  ).length;
  return hit / needleTokens.length;
}

function levenshteinKeys(a: string, b: string): number {
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

export function extractAgeHint(text: string): string | null {
  const match = text.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})/);
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2]}`;
}
