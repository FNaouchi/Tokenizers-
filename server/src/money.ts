const KWD_PATTERN = /^(\d+)(?:\.(\d{1,3}))?$/;

/** Parses a non-negative KWD decimal string (at most 3 places) into integer fils. Returns null if invalid. */
export function parseKwdToFils(text: string): number | null {
  const match = KWD_PATTERN.exec(text.trim());
  if (!match) return null;
  const fils = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return Number.isSafeInteger(fils) ? fils : null;
}

/** Formats integer fils as a 3-decimal string, e.g. 3000000 -> "3000.000". */
export function formatFils(fils: number): string {
  const whole = Math.floor(fils / 1000);
  const frac = String(fils % 1000).padStart(3, '0');
  return `${whole}.${frac}`;
}

/** Formats integer fils with thousands separators for reasons, e.g. "4,830.000". */
export function formatFilsGrouped(fils: number): string {
  const whole = Math.floor(fils / 1000).toLocaleString('en-US');
  return `${whole}.${String(fils % 1000).padStart(3, '0')}`;
}
