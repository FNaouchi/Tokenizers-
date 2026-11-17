import { describe, expect, it } from 'vitest';
import { formatKuwaitTime, parseTimestamp } from '../src/time.js';

describe('parseTimestamp', () => {
  it('reads a +03:00 timestamp as a UTC instant', () => {
    const parsed = parseTimestamp('2026-10-16T15:31:31+03:00');
    expect(parsed?.epochMs).toBe(Date.UTC(2026, 9, 16, 12, 31, 31));
    expect(parsed?.isUtcSuffix).toBe(false);
  });

  it('treats a Z timestamp as the same instant as the matching +03:00 time', () => {
    const utc = parseTimestamp('2026-10-16T12:31:31Z');
    const kuwait = parseTimestamp('2026-10-16T15:31:31+03:00');
    expect(utc?.epochMs).toBe(kuwait?.epochMs);
    expect(utc?.isUtcSuffix).toBe(true);
  });

  it('handles an offset on a different day than UTC', () => {
    expect(parseTimestamp('2026-10-01T01:00:00+03:00')?.epochMs).toBe(Date.UTC(2026, 8, 30, 22, 0, 0));
  });

  it.each([
    '',
    '2026-10-16 12:31:31',
    '2026-10-16T12:31:31',
    '2026-13-01T00:00:00Z',
    '2026-02-30T00:00:00+03:00',
    '2026-10-16T24:00:00Z',
    '2026-10-16T12:60:00Z',
    'not a date',
  ])('rejects %j', (text) => {
    expect(parseTimestamp(text)).toBeNull();
  });
});

describe('formatKuwaitTime', () => {
  it('writes a UTC instant in Kuwait time with the +03:00 offset', () => {
    expect(formatKuwaitTime(Date.UTC(2026, 9, 16, 12, 31, 31))).toBe('2026-10-16T15:31:31+03:00');
  });

  it('rolls over to the next day', () => {
    expect(formatKuwaitTime(parseTimestamp('2026-10-16T22:30:00Z')!.epochMs)).toBe('2026-10-17T01:30:00+03:00');
  });
});
