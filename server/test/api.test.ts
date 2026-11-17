import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { defaultConfig, loadRealDatabase } from './helpers.js';

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
      utc_timestamps: 3,
    });
  });
});

describe('unknown paths', () => {
  it('return a 404 in the standard error format', async () => {
    const res = await request(app).get('/api/nothing');
    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe('NOT_FOUND');
  });
});
