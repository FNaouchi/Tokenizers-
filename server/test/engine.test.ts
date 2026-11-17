import { describe, expect, it } from 'vitest';
import { applyRules, evaluateRules, summarise } from '../src/rules/engine.js';
import type { HighRiskCountry } from '../src/rules/types.js';
import { csvRow, defaultConfig, importFixture, loadRealDatabase, txn } from './helpers.js';

const COUNTRIES: HighRiskCountry[] = [{ country_code: 'XB', country_name: 'Belvaria', reason: 'Fictional: under increased monitoring' }];
const config = defaultConfig();

describe('rules engine', () => {
  it('keeps every rule that fires on one transaction', () => {
    const big = txn('BIG', '2026-10-31T19:17:44+03:00', { amount_kwd_fils: 12_499_999, counterparty_country: 'XB' });
    const flags = evaluateRules([big], COUNTRIES, config);

    expect(flags.map((f) => f.rule_id).sort()).toEqual(['HIGH_RISK_COUNTRY', 'LARGE_AMOUNT']);
    expect(summarise(flags)).toEqual({
      by_rule: { LARGE_AMOUNT: 1, VELOCITY: 0, HIGH_RISK_COUNTRY: 1 },
      flagged_transactions: 1,
    });
  });

  it('flags nothing for ordinary transactions', () => {
    expect(evaluateRules([txn('T1', '2026-10-01T10:00:00+03:00')], COUNTRIES, config)).toEqual([]);
  });

  it('uses the limits it is given, with no code change', () => {
    const t = txn('T1', '2026-10-01T10:00:00+03:00', { amount_kwd_fils: 4_000_000 });
    expect(evaluateRules([t], COUNTRIES, config)).toHaveLength(1);
    expect(evaluateRules([t], COUNTRIES, { ...config, largeAmountKwd: '5000.000' })).toEqual([]);
  });
});

describe('applyRules', () => {
  const rows = [
    csvRow({ transaction_id: 'TXN-1', amount: '3000.000', amount_kwd: '3000.000' }),
    csvRow({ transaction_id: 'TXN-2', counterparty_country: 'XB' }),
    csvRow({ transaction_id: 'TXN-3' }),
  ];

  it('stores the flags and replaces them when run again with other limits', () => {
    const { db } = importFixture({ transactions: rows });

    expect(applyRules(db, config)).toEqual({
      by_rule: { LARGE_AMOUNT: 1, VELOCITY: 0, HIGH_RISK_COUNTRY: 1 },
      flagged_transactions: 2,
    });
    expect(applyRules(db, config).flagged_transactions).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM flags').get()).toEqual({ n: 2 });

    const stricter = applyRules(db, { ...config, largeAmountKwd: '3000.001' });
    expect(stricter.by_rule.LARGE_AMOUNT).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM flags').get()).toEqual({ n: 1 });
  });

  it('changes the real-data results when the config changes', () => {
    const { db } = loadRealDatabase();
    const raised = applyRules(db, { ...config, largeAmountKwd: '5000.000' });
    expect(raised.by_rule.LARGE_AMOUNT).toBeLessThan(73);
    const rows = db
      .prepare(
        `SELECT t.amount_kwd_fils FROM flags f JOIN transactions t USING (transaction_id) WHERE f.rule_id = 'LARGE_AMOUNT'`,
      )
      .all() as { amount_kwd_fils: number }[];
    expect(rows.length).toBe(raised.by_rule.LARGE_AMOUNT);
    expect(rows.every((r) => r.amount_kwd_fils >= 5_000_000)).toBe(true);
  });
});
