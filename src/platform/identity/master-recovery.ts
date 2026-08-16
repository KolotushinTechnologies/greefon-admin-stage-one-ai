const DEFAULT_PHRASE = "От рассвета до заката ботаны вообще ребята, 9084 - едит";

export function defaultMasterRecoveryPhrase(): string {
  return DEFAULT_PHRASE;
}

export function normalizeRecoveryPhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[—–−]/g, "-")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesMasterRecovery(text: string, configured: string): boolean {
  const expected = normalizeRecoveryPhrase(configured.trim().length > 0 ? configured : DEFAULT_PHRASE);
  if (expected.length === 0) {
    return false;
  }
  return normalizeRecoveryPhrase(text) === expected;
}
