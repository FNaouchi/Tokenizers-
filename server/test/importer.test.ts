import { describe, expect, it } from 'vitest';
import { ImportError } from '../src/import/importer.js';
import { parseTimestamp } from '../src/time.js';
import { csvRow, importFixture, loadRealDatabase } from './helpers.js';

interface Stored {
  transaction_id: string;
  ts_epoch_ms: number;
  amount_kwd_fils: number | null;
  counterparty_country: string | null;
  source_row: number;
  dq_notes: string;
}

const stored = (db: ReturnType<typeof importFixture>['db'], id: string) =>
  db.prepare('SELECT * FROM transactions WHERE transaction_id = ?').get(id) as Stored | undefined;
const rejects = (db: ReturnType<typeof importFixture>['db']) =>
  db.prepare('SELECT file, source_row, reason FROM import_rejects ORDER BY id').all() as {
    file: string;
    source_row: number;
    reason: string;
  }[];

describe('importer: duplicate transaction ids', () => {
  it('keeps the first of an identical duplicate and records the drop', () => {
    const row = csvRow({ transaction_id: 'TXN-DUP' });
    const { db, report } = importFixture({ transactions: [row, csvRow({ transaction_id: 'TXN-OK' }), row] });

    expect(report).toMatchObject({ rows_read: 3, rows_loaded: 2, duplicates_dropped: 1, rows_rejected: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE transaction_id = ?').get('TXN-DUP')).toEqual({ n: 1 });
    expect(rejects(db)).toEqual([{ file: 'transactions.csv', source_row: 4, reason: 'DUPLICATE_IDENTICAL' }]);
  });

  it('keeps the first and rejects a repeat whose content differs', () => {
    const { db, report } = importFixture({
      transactions: [
        csvRow({ transaction_id: 'TXN-DUP', amount: '100.000', amount_kwd: '100.000' }),
        csvRow({ transaction_id: 'TXN-DUP', amount: '999.000', amount_kwd: '999.000' }),
      ],
    });
    expect(report).toMatchObject({ rows_loaded: 1, duplicates_dropped: 0, rows_rejected: 1 });
    expect(stored(db, 'TXN-DUP')?.amount_kwd_fils).toBe(100_000);
    expect(rejects(db)[0].reason).toBe('DUPLICATE_CONFLICT');
  });
});

describe('importer: missing values', () => {
  it('loads a row with no counterparty country as NULL and notes it', () => {
    const { db, report } = importFixture({ transactions: [csvRow({ transaction_id: 'TXN-1', counterparty_country: '' })] });
    expect(stored(db, 'TXN-1')?.counterparty_country).toBeNull();
    expect(JSON.parse(stored(db, 'TXN-1')!.dq_notes)).toEqual(['MISSING_COUNTRY']);
    expect(report.missing_country).toBe(1);
  });

  it('loads a row with no amount as NULL and notes it', () => {
    const { db, report } = importFixture({
      transactions: [csvRow({ transaction_id: 'TXN-1', amount: '', amount_kwd: '' })],
    });
    const row = stored(db, 'TXN-1')!;
    expect(row.amount_kwd_fils).toBeNull();
    expect(JSON.parse(row.dq_notes)).toEqual(['MISSING_AMOUNT']);
    expect(report).toMatchObject({ rows_loaded: 1, missing_amount: 1 });
  });
});

describe('importer: country codes', () => {
  it('trims and upper-cases a code and notes the fix', () => {
    const { db, report } = importFixture({
      transactions: [
        csvRow({ transaction_id: 'TXN-1', counterparty_country: 'xd' }),
        csvRow({ transaction_id: 'TXN-2', counterparty_country: ' xb' }),
        csvRow({ transaction_id: 'TXN-3', counterparty_country: 'KW' }),
      ],
    });
    expect(stored(db, 'TXN-1')?.counterparty_country).toBe('XD');
    expect(stored(db, 'TXN-2')?.counterparty_country).toBe('XB');
    expect(JSON.parse(stored(db, 'TXN-2')!.dq_notes)).toEqual(['COUNTRY_NORMALISED']);
    expect(JSON.parse(stored(db, 'TXN-3')!.dq_notes)).toEqual([]);
    expect(report.country_normalised).toBe(2);
  });

  it('keeps a row whose country is not two letters, with no country and a note, so other rules still see it', () => {
    const { db, report } = importFixture({
      transactions: [
        csvRow({ transaction_id: 'TXN-1', counterparty_country: 'KWT', amount_kwd: '5000.000' }),
        csvRow({ transaction_id: 'TXN-2', counterparty_country: '1A' }),
      ],
    });
    expect(report).toMatchObject({ rows_loaded: 2, rows_rejected: 0, invalid_country: 2 });
    expect(stored(db, 'TXN-1')?.counterparty_country).toBeNull();
    expect(stored(db, 'TXN-1')?.amount_kwd_fils).toBe(5_000_000);
    expect(JSON.parse(stored(db, 'TXN-1')!.dq_notes)).toEqual(['INVALID_COUNTRY']);
    expect(rejects(db)).toEqual([]);
  });

  it('normalises the high-risk list itself', () => {
    const { db } = importFixture({ transactions: [csvRow()], highRisk: [' xb ,Belvaria,Fictional'] });
    expect(db.prepare('SELECT country_code FROM high_risk_countries').all()).toEqual([{ country_code: 'XB' }]);
  });

  it('stops the import when the high-risk list has a malformed entry, instead of silently dropping it', () => {
    expect(() =>
      importFixture({ transactions: [csvRow()], highRisk: ['XB,Belvaria,Fictional', 'X1,Brokenia,Fictional', 'XC,,Fictional'] }),
    ).toThrow(ImportError);
    try {
      importFixture({ transactions: [csvRow()], highRisk: ['X1,Brokenia,Fictional', 'XC,,Fictional'] });
    } catch (err) {
      expect((err as ImportError).problems).toHaveLength(2);
    }
  });

  it('ignores a repeated entry in the high-risk list', () => {
    const { db } = importFixture({
      transactions: [csvRow()],
      highRisk: ['XB,Belvaria,Fictional', 'xb,Belvaria,Fictional'],
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM high_risk_countries').get()).toEqual({ n: 1 });
    expect(rejects(db)).toEqual([{ file: 'high_risk_countries.csv', source_row: 3, reason: 'DUPLICATE_COUNTRY' }]);
  });
});

describe('importer: timestamps and order', () => {
  it('stores a Z timestamp as the same instant as the matching +03:00 time and notes it', () => {
    const { db, report } = importFixture({
      transactions: [
        csvRow({ transaction_id: 'TXN-Z', timestamp: '2026-10-16T12:31:31Z' }),
        csvRow({ transaction_id: 'TXN-K', timestamp: '2026-10-16T15:31:31+03:00' }),
      ],
    });
    expect(stored(db, 'TXN-Z')!.ts_epoch_ms).toBe(stored(db, 'TXN-K')!.ts_epoch_ms);
    expect(stored(db, 'TXN-Z')!.ts_epoch_ms).toBe(parseTimestamp('2026-10-16T12:31:31Z')!.epochMs);
    expect(JSON.parse(stored(db, 'TXN-Z')!.dq_notes)).toEqual(['UTC_TIMESTAMP']);
    expect(report.utc_timestamps).toBe(1);
  });

  it('loads late-arriving rows with their real time and file position', () => {
    const { db } = importFixture({
      transactions: [
        csvRow({ transaction_id: 'TXN-1', timestamp: '2026-10-31T23:00:00+03:00' }),
        csvRow({ transaction_id: 'TXN-LATE', timestamp: '2026-10-06T10:31:02+03:00' }),
      ],
    });
    const late = stored(db, 'TXN-LATE')!;
    expect(late.source_row).toBe(3);
    expect(late.ts_epoch_ms).toBeLessThan(stored(db, 'TXN-1')!.ts_epoch_ms);
  });
});

describe('importer: rejected rows', () => {
  it.each([
    ['an invalid timestamp', { timestamp: '2026-10-01 10:00:00' }, 'INVALID_TIMESTAMP'],
    ['an amount with more than 3 decimals', { amount_kwd: '1.2345' }, 'INVALID_AMOUNT'],
    ['a negative amount', { amount_kwd: '-5.000' }, 'INVALID_AMOUNT'],
    ['an unknown account', { account_id: 'ACC-999999' }, 'UNKNOWN_ACCOUNT'],
    ['an invalid direction', { direction: 'SIDEWAYS' }, 'INVALID_DIRECTION'],
    ['a missing required field', { channel: '' }, 'MISSING_FIELD:channel'],
  ])('rejects %s and records why', (_label, overrides, reason) => {
    const { db, report } = importFixture({ transactions: [csvRow(overrides), csvRow({ transaction_id: 'TXN-OK' })] });
    expect(report).toMatchObject({ rows_read: 2, rows_loaded: 1, rows_rejected: 1 });
    expect(rejects(db)).toEqual([{ file: 'transactions.csv', source_row: 2, reason }]);
  });

  it('keeps rows read equal to loaded plus duplicates dropped plus rejected', () => {
    const dup = csvRow({ transaction_id: 'TXN-DUP' });
    const { report } = importFixture({
      transactions: [dup, dup, csvRow({ transaction_id: 'TXN-BAD', timestamp: 'nope' }), csvRow({ transaction_id: 'TXN-OK' })],
    });
    expect(report.rows_read).toBe(report.rows_loaded + report.duplicates_dropped + report.rows_rejected);
  });

  it('rejects an account with a repeated id or an unknown segment', () => {
    const { db } = importFixture({
      transactions: [csvRow()],
      accounts: [
        'ACC-100001,CUS-1,RETAIL,Jahra,2020-01-01',
        'ACC-100001,CUS-9,SME,Jahra,2020-01-01',
        'ACC-100002,CUS-2,VIP,Hawalli,2021-02-02',
      ],
    });
    expect(rejects(db).map((r) => [r.file, r.reason])).toEqual([
      ['accounts.csv', 'DUPLICATE_ACCOUNT'],
      ['accounts.csv', 'INVALID_SEGMENT'],
    ]);
  });
});

describe('importer: real data (golden test)', () => {
  const { db, report } = loadRealDatabase();
  const flagged = (id: string) =>
    (db.prepare('SELECT rule_id FROM flags WHERE transaction_id = ?').all(id) as { rule_id: string }[]).map((f) => f.rule_id);
  const velocityOnAccount = (account: string) =>
    (db
      .prepare(`SELECT COUNT(*) AS n FROM flags f JOIN transactions t USING (transaction_id) WHERE f.rule_id = 'VELOCITY' AND t.account_id = ?`)
      .get(account) as { n: number }).n;

  it('reports what the import did with the data issues', () => {
    expect(report).toEqual({
      rows_read: 3079,
      rows_loaded: 3077,
      duplicates_dropped: 2,
      rows_rejected: 0,
      missing_amount: 1,
      missing_country: 3,
      country_normalised: 2,
      invalid_country: 0,
      utc_timestamps: 3,
    });
  });

  it('flags the expected number of transactions per rule', () => {
    const count = (rule: string) => (db.prepare('SELECT COUNT(*) AS n FROM flags WHERE rule_id = ?').get(rule) as { n: number }).n;
    expect(count('LARGE_AMOUNT')).toBe(73);
    expect(count('VELOCITY')).toBe(28);
    expect(count('HIGH_RISK_COUNTRY')).toBe(16);
    expect((db.prepare('SELECT COUNT(DISTINCT transaction_id) AS n FROM flags').get() as { n: number }).n).toBe(115);
  });

  it('handles the amount boundary and the missing amount', () => {
    expect(flagged('TXN-000906')).toEqual(['LARGE_AMOUNT']); // exactly 3000.000
    expect(flagged('TXN-002937')).toEqual([]); // 2999.999
    expect(flagged('TXN-000921')).toEqual([]); // no amount
  });

  it('handles the 60-minute boundary and de-duplication', () => {
    expect(velocityOnAccount('ACC-100069')).toBe(5); // exactly 60:00
    expect(velocityOnAccount('ACC-100054')).toBe(0); // 60:01
    expect(velocityOnAccount('ACC-100107')).toBe(0); // only 5 with the duplicate counted twice
  });

  it('puts the late row and the Z row into their bursts', () => {
    expect(flagged('TXN-003074')).toContain('VELOCITY');
    expect(flagged('TXN-002458')).toContain('VELOCITY');
  });

  it('flags the cleaned country codes and skips missing countries', () => {
    expect(flagged('TXN-002741')).toContain('HIGH_RISK_COUNTRY'); // ' xb'
    expect(flagged('TXN-002447')).toContain('HIGH_RISK_COUNTRY'); // 'xd'
    for (const id of ['TXN-001143', 'TXN-002893', 'TXN-003002']) expect(flagged(id)).not.toContain('HIGH_RISK_COUNTRY');
  });

  it('shows every rule on a transaction that fires several', () => {
    expect(flagged('TXN-003053').sort()).toEqual(['HIGH_RISK_COUNTRY', 'LARGE_AMOUNT']);
    expect(flagged('TXN-000585').sort()).toEqual(['HIGH_RISK_COUNTRY', 'VELOCITY']);
  });
});
