import type { KnowledgeField } from "./types.js";

export function docFields(fields: KnowledgeField[] | undefined | null): KnowledgeField[] {
  return fields ?? [];
}

export function composeKnowledgeText(fields: KnowledgeField[] | undefined | null, body: string): string {
  const facts = docFields(fields)
    .map((field) => `${field.key.trim()}: ${field.value.trim()}`)
    .filter((line) => line !== ":")
    .join("\n");
  return [facts, body.trim()].filter((part) => part.length > 0).join("\n\n");
}

export function normalizeFieldKey(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function parseFieldLine(text: string): { key: string; value: string } | null {
  const trimmed = text.trim();
  const split = trimmed.match(/^([^:=\n]{1,40})\s*[:=]\s*([\s\S]+)$/);
  if (!split?.[1] || split[2] === undefined) {
    return null;
  }
  const key = normalizeFieldKey(split[1]);
  const value = split[2].trim();
  if (key.length === 0 || value.length === 0) {
    return null;
  }
  return { key, value };
}
