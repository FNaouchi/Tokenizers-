const KUWAIT_OFFSET_MINUTES = 3 * 60;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/;

export interface ParsedTimestamp {
  epochMs: number;
  /** True when the source wrote the time in UTC with a trailing Z. */
  isUtcSuffix: boolean;
}

/** Parses an ISO 8601 timestamp with an offset or Z into a UTC instant. Returns null if invalid. */
export function parseTimestamp(text: string): ParsedTimestamp | null {
  const match = TIMESTAMP_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, zone] = match;
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const offHours = Number(zone.slice(1, 3));
    const offMins = Number(zone.slice(4, 6));
    if (offHours > 23 || offMins > 59) return null;
    offsetMinutes = sign * (offHours * 60 + offMins);
  }

  const localMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, minute, second);
  const check = new Date(localMs);
  if (check.getUTCFullYear() !== Number(y) || check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) {
    return null;
  }
  return { epochMs: localMs - offsetMinutes * 60_000, isUtcSuffix: zone === 'Z' };
}

/** Formats a UTC instant in Kuwait time, e.g. "2026-10-16T15:31:31+03:00". */
export function formatKuwaitTime(epochMs: number): string {
  return new Date(epochMs + KUWAIT_OFFSET_MINUTES * 60_000).toISOString().slice(0, 19) + '+03:00';
}
