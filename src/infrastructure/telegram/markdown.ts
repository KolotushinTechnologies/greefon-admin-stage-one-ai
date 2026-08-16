const TELEGRAM_LIMIT = 3500;

export function markdownToTelegramHtml(source: string): string {
  const fences: string[] = [];
  let text = flattenTelegramMarkdown(source).replace(/```([\s\S]*?)```/g, (_, code: string) => {
    const index = fences.length;
    fences.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    return `@@FENCE${index}@@`;
  });

  const inlines: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code: string) => {
    const index = inlines.length;
    inlines.push(`<code>${escapeHtml(code)}</code>`);
    return `@@CODE${index}@@`;
  });

  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|tg:\/\/user\?id=\d+)\)/g, (_match, label: string, href: string) => {
    const safe = href.replace(/"/g, "");
    return `<a href="${safe}">${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  text = text.replace(/^#{1,3}\s+(.+)$/gm, "<b>$1</b>");
  text = text.replace(/^[-•]\s+/gm, "• ");

  text = text.replace(/@@CODE(\d+)@@/g, (_, index: string) => inlines[Number(index)] ?? "");
  text = text.replace(/@@FENCE(\d+)@@/g, (_, index: string) => fences[Number(index)] ?? "");
  return text.trim();
}

export function splitTelegramText(text: string): string[] {
  if (text.length <= TELEGRAM_LIMIT) {
    return [text];
  }
  const parts: string[] = [];
  let rest = text;
  while (rest.length > TELEGRAM_LIMIT) {
    let cut = rest.lastIndexOf("\n", TELEGRAM_LIMIT);
    if (cut < TELEGRAM_LIMIT / 2) {
      cut = TELEGRAM_LIMIT;
    }
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) {
    parts.push(rest);
  }
  return parts;
}

export function flattenTelegramMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const table = readMarkdownTable(lines, index);
    if (table) {
      out.push(...formatMarkdownTable(table.rows));
      index = table.next;
      continue;
    }
    const line = lines[index] ?? "";
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      index += 1;
      continue;
    }
    out.push(line);
    index += 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function readMarkdownTable(lines: string[], start: number): { rows: string[][]; next: number } | null {
  const first = lines[start] ?? "";
  if (!looksLikeTableRow(first)) {
    return null;
  }
  const second = lines[start + 1] ?? "";
  if (!isTableSeparator(second) && !looksLikeTableRow(second)) {
    return null;
  }
  const rows: string[][] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isTableSeparator(line)) {
      index += 1;
      continue;
    }
    if (!looksLikeTableRow(line)) {
      break;
    }
    rows.push(splitTableCells(line));
    index += 1;
  }
  if (rows.length < 2) {
    return null;
  }
  return { rows, next: index };
}

function formatMarkdownTable(rows: string[][]): string[] {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const out: string[] = [];
  for (const row of body) {
    const parts: string[] = [];
    for (let col = 0; col < row.length; col += 1) {
      const cell = (row[col] ?? "").trim();
      if (cell.length === 0) {
        continue;
      }
      if (col === 0) {
        parts.push(`**${cell.replace(/\*\*/g, "")}**`);
        continue;
      }
      const key = (header[col] ?? "").trim();
      parts.push(key.length > 0 ? `${key}: ${cell}` : cell);
    }
    if (parts.length > 0) {
      out.push(`• ${parts.join(" · ")}`);
    }
  }
  return out;
}

function looksLikeTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return false;
  }
  return trimmed.startsWith("|") || /\|.+\|/.test(trimmed);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
