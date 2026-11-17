import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.js';
import { createFreshDatabase } from '../src/db.js';
import { applyRules } from '../src/rules/engine.js';
import { csvRow, defaultConfig, importFixture, loadRealDatabase } from './helpers.js';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const { db, config } = loadRealDatabase();
  app = createApp(db, config);
});

const errorOf = (body: { error: { code: string; details?: { field: string }[] } }) => body.error;

describe('GET /api/flags', () => {
  it('returns flagged transactions with account context and every rule that fired', async () => {
    const res = await request(app).get('/api/flags?limit=500');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 115, limit: 500, offset: 0 });
    expect(res.body.items).toHaveLength(115);

    const multi = res.body.items.find((i: { transaction_id: string }) => i.transaction_id === 'TXN-003053');
    expect(multi).toMatchObject({
      transaction_id: 'TXN-003053',
      timestamp: '2026-10-31T19:17:44+03:00',
      account: { account_id: 'ACC-100065', customer_segment: 'RETAIL', home_branch: 'Hawalli' },
      amount_kwd: '12499.999',
      counterparty_country: 'XB',
      data_quality: [],
    });
    expect(multi.flags.map((f: { rule_id: string }) => f.rule_id)).toEqual(['LARGE_AMOUNT', 'HIGH_RISK_COUNTRY']);
    expect(multi.flags[0]).toMatchObject({
      reason: 'LARGE_AMOUNT: 12,499.999 KWD (limit: ≥ 3,000.000 KWD)',
      details: { amount_kwd: '12499.999', limit_kwd: '3000.000' },
    });
  });

  it('lists newest first and defaults to 50 per page', async () => {
    const res = await request(app).get('/api/flags');
    expect(res.body.items).toHaveLength(50);
    expect(res.body.limit).toBe(50);
    const times = res.body.items.map((i: { timestamp: string }) => i.timestamp);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('sorts by number of flags, then newest first, and rejects an unknown sort', async () => {
    const res = await request(app).get('/api/flags?sort=most_flags&limit=500');
    const counts = res.body.items.map((i: { flags: unknown[] }) => i.flags.length);
    expect(counts[0]).toBeGreaterThan(1);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const lastMulti = counts.lastIndexOf(2);
    const multiTimes = res.body.items.slice(0, lastMulti + 1).map((i: { timestamp: string }) => i.timestamp);
    expect(multiTimes).toEqual([...multiTimes].sort().reverse());
    expect(res.body.items[0].transaction_id).toBe(
      (await request(app).get('/api/flags?limit=500')).body.items.find((i: { flags: unknown[] }) => i.flags.length > 1).transaction_id,
    );

    const bad = await request(app).get('/api/flags?sort=oldest');
    expect(bad.status).toBe(400);
    expect(errorOf(bad.body).details?.[0].field).toBe('sort');
  });

  it('filters by rule but still shows all the rules that fired on each transaction', async () => {
    const res = await request(app).get('/api/flags?rule=HIGH_RISK_COUNTRY&limit=500');
    expect(res.body.total).toBe(16);
    for (const item of res.body.items) {
      expect(item.flags.map((f: { rule_id: string }) => f.rule_id)).toContain('HIGH_RISK_COUNTRY');
    }
    const both = res.body.items.find((i: { transaction_id: string }) => i.transaction_id === 'TXN-003053');
    expect(both.flags).toHaveLength(2);
  });

  it('filters by account, and by rule and account together', async () => {
    const account = await request(app).get('/api/flags?account_id=ACC-100118');
    expect(account.body.total).toBe(7);
    expect(account.body.items.every((i: { account: { account_id: string } }) => i.account.account_id === 'ACC-100118')).toBe(true);

    const combined = await request(app).get('/api/flags?account_id=ACC-100118&rule=HIGH_RISK_COUNTRY');
    expect(combined.body.total).toBe(1);
    expect(combined.body.items[0].transaction_id).toBe('TXN-000585');
  });

  it('returns an empty list, not an error, for an account with no flags', async () => {
    const res = await request(app).get('/api/flags?account_id=ACC-100054');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('pages through the results', async () => {
    const first = await request(app).get('/api/flags?limit=10&offset=0');
    const second = await request(app).get('/api/flags?limit=10&offset=10');
    expect(second.body.items).toHaveLength(10);
    expect(second.body.items[0].transaction_id).not.toBe(first.body.items[0].transaction_id);
    const beyond = await request(app).get('/api/flags?limit=10&offset=500');
    expect(beyond.body).toMatchObject({ items: [], total: 115 });
  });

  it('shows the data-quality notes and Kuwait time for a cleaned row', async () => {
    const res = await request(app).get('/api/flags?rule=VELOCITY&account_id=ACC-100023');
    const utcRow = res.body.items.find((i: { transaction_id: string }) => i.transaction_id === 'TXN-002458');
    expect(utcRow.timestamp).toBe('2026-10-25T10:20:00+03:00');
    expect(utcRow.data_quality).toEqual(['UTC_TIMESTAMP']);
  });

  it('shows the actual values behind a burst', async () => {
    const res = await request(app).get('/api/flags?rule=VELOCITY&account_id=ACC-100069');
    const flag = res.body.items[0].flags[0];
    expect(res.body.total).toBe(5);
    expect(flag.reason).toBe('VELOCITY: 5 transactions in 60 min (limit: 5 in 60 min)');
    expect(flag.details).toMatchObject({ count: 5, span_seconds: 3600, limit_count: 5, limit_window_minutes: 60 });
    expect(flag.details.related_transaction_ids).toHaveLength(4);
  });

  it.each([
    ['an unknown rule', 'rule=FOO', 'rule'],
    ['a malformed account', 'account_id=100118', 'account_id'],
    ['a limit of 0', 'limit=0', 'limit'],
    ['a limit above 500', 'limit=501', 'limit'],
    ['a non-numeric limit', 'limit=abc', 'limit'],
    ['a negative offset', 'offset=-1', 'offset'],
    ['a repeated rule', 'rule=VELOCITY&rule=LARGE_AMOUNT', 'rule'],
  ])('returns 400 for %s', async (_label, query, field) => {
    const res = await request(app).get(`/api/flags?${query}`);
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
    expect(errorOf(res.body).details?.map((d) => d.field)).toEqual([field]);
  });

  it('reports every invalid field at once', async () => {
    const res = await request(app).get('/api/flags?rule=FOO&account_id=bad&limit=0&offset=-1');
    expect(res.status).toBe(400);
    expect(errorOf(res.body).details?.map((d) => d.field)).toEqual(['rule', 'account_id', 'limit', 'offset']);
  });
});

describe('GET /api/flags/summary', () => {
  it('returns the count per rule and the totals', async () => {
    const res = await request(app).get('/api/flags/summary');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      by_rule: { LARGE_AMOUNT: 73, VELOCITY: 28, HIGH_RISK_COUNTRY: 16 },
      flagged_transactions: 115,
      total_transactions: 3077,
    });
  });

  it('counts only one account when asked, listing every rule even at 0', async () => {
    const res = await request(app).get('/api/flags/summary?account_id=ACC-100118');
    expect(res.body).toEqual({
      by_rule: { LARGE_AMOUNT: 0, VELOCITY: 7, HIGH_RISK_COUNTRY: 1 },
      flagged_transactions: 7,
      total_transactions: 19,
    });
  });

  it('returns zeros for a well-formed account that does not exist', async () => {
    const res = await request(app).get('/api/flags/summary?account_id=ACC-999999');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      by_rule: { LARGE_AMOUNT: 0, VELOCITY: 0, HIGH_RISK_COUNTRY: 0 },
      flagged_transactions: 0,
      total_transactions: 0,
    });
  });

  it('returns 400 for a malformed account', async () => {
    const res = await request(app).get('/api/flags/summary?account_id=nope');
    expect(res.status).toBe(400);
    expect(errorOf(res.body).details?.map((d) => d.field)).toEqual(['account_id']);
  });
});

describe('transaction filters on /api/flags and /api/flags/summary', () => {
  const row = (n: number, timestamp: string, account: string, amount: string) =>
    csvRow({ transaction_id: `TXN-00000${n}`, timestamp, account_id: account, amount, amount_kwd: amount });

  let filtered: ReturnType<typeof createApp>;
  beforeAll(() => {
    const { db } = importFixture({
      transactions: [
        row(1, '2026-10-24T23:59:59+03:00', 'ACC-100001', '3000.000'),
        row(2, '2026-10-25T00:00:00+03:00', 'ACC-100001', '3000.001'),
        row(3, '2026-10-25T23:59:59+03:00', 'ACC-100002', '5000.000'),
        row(4, '2026-10-26T00:00:00+03:00', 'ACC-100002', '4000.000'),
        row(5, '2026-10-24T21:30:00Z', 'ACC-100002', '3500.000'),
        row(6, '2026-10-25T10:00:00+03:00', 'ACC-100002', '100.000'),
      ],
    });
    const config = defaultConfig();
    applyRules(db, config);
    filtered = createApp(db, config);
  });

  const ids = async (query: string) => {
    const res = await request(filtered).get(`/api/flags?${query}`);
    expect(res.status).toBe(200);
    return res.body.items.map((i: { transaction_id: string }) => i.transaction_id.slice(-1)).sort();
  };

  it('treats both date ends as whole Kuwait days, including a UTC record', async () => {
    expect(await ids('date_from=2026-10-25&date_to=2026-10-25')).toEqual(['2', '3', '5']);
    expect(await ids('date_to=2026-10-24')).toEqual(['1']);
    expect(await ids('date_from=2026-10-26')).toEqual(['4']);
  });

  it('filters by segment and branch', async () => {
    expect(await ids('segment=RETAIL')).toEqual(['1', '2']);
    expect(await ids('segment=SME')).toEqual(['3', '4', '5']);
    expect(await ids('branch=Hawalli')).toEqual(['3', '4', '5']);
    expect(await ids('branch=Jahra&segment=SME')).toEqual([]);
  });

  it('includes an amount equal to the minimum and excludes one just below it', async () => {
    expect(await ids('min_amount_kwd=3000')).toEqual(['1', '2', '3', '4', '5']);
    expect(await ids('min_amount_kwd=3000.001')).toEqual(['2', '3', '4', '5']);
    expect(await ids('min_amount_kwd=3000.002')).toEqual(['3', '4', '5']);
  });

  it('reports the total for the filtered list', async () => {
    const res = await request(filtered).get('/api/flags?segment=SME&min_amount_kwd=4000&limit=1');
    expect(res.body).toMatchObject({ total: 2, limit: 1 });
    expect(res.body.items).toHaveLength(1);
  });

  it('applies every filter to every summary count, including the transaction total', async () => {
    const unfiltered = await request(filtered).get('/api/flags/summary');
    expect(unfiltered.body).toEqual({
      by_rule: { LARGE_AMOUNT: 5, VELOCITY: 0, HIGH_RISK_COUNTRY: 0 },
      flagged_transactions: 5,
      total_transactions: 6,
    });
    const day = await request(filtered).get('/api/flags/summary?segment=SME&date_from=2026-10-25&date_to=2026-10-25');
    expect(day.body).toEqual({
      by_rule: { LARGE_AMOUNT: 2, VELOCITY: 0, HIGH_RISK_COUNTRY: 0 },
      flagged_transactions: 2,
      total_transactions: 3,
    });
    const big = await request(filtered).get('/api/flags/summary?branch=Hawalli&min_amount_kwd=4000');
    expect(big.body).toEqual({
      by_rule: { LARGE_AMOUNT: 2, VELOCITY: 0, HIGH_RISK_COUNTRY: 0 },
      flagged_transactions: 2,
      total_transactions: 2,
    });
  });

  it('returns 400 listing every invalid filter', async () => {
    const query = 'date_from=2026-02-30&date_to=yesterday&segment=VIP&branch=&min_amount_kwd=-5';
    for (const path of ['/api/flags', '/api/flags/summary']) {
      const res = await request(filtered).get(`${path}?${query}`);
      expect(res.status).toBe(400);
      expect(errorOf(res.body).details?.map((d) => d.field)).toEqual(['date_from', 'date_to', 'segment', 'branch', 'min_amount_kwd']);
    }
    const reversed = await request(filtered).get('/api/flags?date_from=2026-10-26&date_to=2026-10-25');
    expect(reversed.status).toBe(400);
    expect(errorOf(reversed.body).details?.map((d) => d.field)).toEqual(['date_to']);
  });
});

describe('GET /api/transactions/:id', () => {
  it('returns a flagged transaction with all its flags', async () => {
    const res = await request(app).get('/api/transactions/TXN-000585');
    expect(res.status).toBe(200);
    expect(res.body.flags.map((f: { rule_id: string }) => f.rule_id)).toEqual(['VELOCITY', 'HIGH_RISK_COUNTRY']);
  });

  it('returns an unflagged transaction with an empty flags list', async () => {
    const res = await request(app).get('/api/transactions/TXN-000001');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ transaction_id: 'TXN-000001', amount_kwd: '8.674', flags: [], data_quality: [] });
  });

  it('returns null amount and a data-quality note for the row with no amount', async () => {
    const res = await request(app).get('/api/transactions/TXN-000921');
    expect(res.body).toMatchObject({ amount_kwd: null, data_quality: ['MISSING_AMOUNT'], flags: [] });
  });

  it('returns null country and a note for a row with no country', async () => {
    const res = await request(app).get('/api/transactions/TXN-001143');
    expect(res.body).toMatchObject({ counterparty_country: null, data_quality: ['MISSING_COUNTRY'] });
  });

  it('returns 404 for a transaction that does not exist', async () => {
    const res = await request(app).get('/api/transactions/TXN-999999');
    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe('NOT_FOUND');
  });
});

describe('GET /api/config', () => {
  it('returns the limits the rules use and the high-risk countries', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.large_amount_kwd).toBe('3000.000');
    expect(res.body.velocity).toEqual({ min_count: 5, window_minutes: 60 });
    expect(res.body.high_risk_countries.map((c: { country_code: string }) => c.country_code)).toEqual(['XA', 'XB', 'XC', 'XD']);
  });

  it('lists the segments and branches that can be filtered on', async () => {
    const res = await request(app).get('/api/config');
    expect(res.body.customer_segments).toEqual(['RETAIL', 'SME', 'CORPORATE']);
    expect(res.body.branches).toEqual(expect.arrayContaining(['Jahra', 'Hawalli']));
    expect(res.body.branches).toEqual([...res.body.branches].sort());
  });

  it('shows the limits it was given', async () => {
    const { db } = loadRealDatabase();
    const custom = createApp(db, { ...defaultConfig(), largeAmountKwd: '5000', velocity: { minCount: 4, windowMinutes: 30 } });
    const res = await request(custom).get('/api/config');
    expect(res.body.large_amount_kwd).toBe('5000.000');
    expect(res.body.velocity).toEqual({ min_count: 4, window_minutes: 30 });
  });
});

describe('GET /api/import-report', () => {
  it('returns what the import did with the data issues', async () => {
    const res = await request(app).get('/api/import-report');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
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
  it('returns 404 when the database has no import report', async () => {
    const empty = createApp(createFreshDatabase(':memory:'), defaultConfig());
    const res = await request(empty).get('/api/import-report');
    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe('NOT_FOUND');
  });
});

describe('GET /api/not-assessed', () => {
  it('lists the transactions a rule could not check, with which rule was skipped', async () => {
    const res = await request(app).get('/api/not-assessed');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 4, limit: 50, offset: 0 });
    const byId = Object.fromEntries(res.body.items.map((i: { transaction_id: string }) => [i.transaction_id, i]));
    expect(Object.keys(byId).sort()).toEqual(['TXN-000921', 'TXN-001143', 'TXN-002893', 'TXN-003002']);
    expect(byId['TXN-000921']).toMatchObject({ amount_kwd: null, data_quality: ['MISSING_AMOUNT'], not_assessed: ['LARGE_AMOUNT'] });
    expect(byId['TXN-001143']).toMatchObject({ counterparty_country: null, not_assessed: ['HIGH_RISK_COUNTRY'] });
    expect(byId['TXN-001143'].account).toHaveProperty('customer_segment');
  });

  it('filters by account and pages the results', async () => {
    const one = await request(app).get('/api/not-assessed?account_id=ACC-100133');
    expect(one.body.items.map((i: { transaction_id: string }) => i.transaction_id)).toEqual(['TXN-000921']);
    const paged = await request(app).get('/api/not-assessed?limit=1&offset=3');
    expect(paged.body).toMatchObject({ total: 4, limit: 1, offset: 3 });
    expect(paged.body.items).toHaveLength(1);
  });

  it('returns 400 for a malformed account, a bad limit or a bad offset', async () => {
    const res = await request(app).get('/api/not-assessed?account_id=x&limit=0&offset=-1');
    expect(res.status).toBe(400);
    expect(errorOf(res.body).details?.map((d) => d.field)).toEqual(['account_id', 'limit', 'offset']);
  });
});

describe('errors', () => {
  it('returns 400 BAD_REQUEST, not 500, for a badly encoded URL', async () => {
    const res = await request(app).get('/api/transactions/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: 'The request could not be read.', details: [] } });
  });

  it('returns 500 with a general message and no internal details when something fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, config } = loadRealDatabase();
    const broken = createApp(db, config);
    db.close();
    const res = await request(broken).get('/api/flags');
    log.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', details: [] } });
  });

  it('always includes a details array', async () => {
    const res = await request(app).get('/api/transactions/TXN-999999');
    expect(res.body.error.details).toEqual([]);
  });

  it('refuses to start with a limit that cannot be shown', () => {
    const { db } = loadRealDatabase();
    expect(() => createApp(db, { ...defaultConfig(), largeAmountKwd: 'oops' })).toThrow(/Invalid large amount limit/);
  });
});

describe('unknown paths', () => {
  it('return a 404 in the standard error format', async () => {
    const res = await request(app).get('/api/nothing');
    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe('NOT_FOUND');
  });
});
