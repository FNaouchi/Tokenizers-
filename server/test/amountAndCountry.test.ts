import { describe, expect, it } from 'vitest';
import { largeAmount } from '../src/rules/largeAmount.js';
import { highRiskCountry } from '../src/rules/highRiskCountry.js';
import type { HighRiskCountry } from '../src/rules/types.js';
import { txn } from './helpers.js';

const AT = '2026-10-01T10:00:00+03:00';

describe('LARGE_AMOUNT', () => {
  const limit = '3000.000';

  it('flags a large amount and explains it with the value and the limit', () => {
    const flags = largeAmount([txn('T1', AT, { amount_kwd_fils: 4_830_000 })], limit);
    expect(flags).toHaveLength(1);
    expect(flags[0].rule_id).toBe('LARGE_AMOUNT');
    expect(flags[0].reason).toBe('LARGE_AMOUNT: 4,830.000 KWD (limit: ≥ 3,000.000 KWD)');
    expect(flags[0].details).toEqual({ amount_kwd: '4830.000', limit_kwd: '3000.000' });
  });

  it('does not flag a small amount', () => {
    expect(largeAmount([txn('T1', AT, { amount_kwd_fils: 8_674 })], limit)).toEqual([]);
  });

  it('flags exactly 3,000.000 KWD but not 2,999.999 KWD', () => {
    const flagged = largeAmount(
      [
        txn('AT_LIMIT', AT, { amount_kwd_fils: 3_000_000 }),
        txn('BELOW', AT, { amount_kwd_fils: 2_999_999 }),
        txn('ABOVE', AT, { amount_kwd_fils: 3_000_001 }),
      ],
      limit,
    ).map((f) => f.transaction_id);
    expect(flagged).toEqual(['AT_LIMIT', 'ABOVE']);
  });

  it('skips a transaction with no amount', () => {
    expect(largeAmount([txn('T1', AT, { amount_kwd_fils: null })], limit)).toEqual([]);
  });

  it('reads the limit from its argument, so a different limit changes the result', () => {
    const txns = [txn('T1', AT, { amount_kwd_fils: 4_830_000 })];
    expect(largeAmount(txns, '5000.000')).toEqual([]);
    expect(largeAmount(txns, '4830.000')).toHaveLength(1);
  });

  it('rejects an invalid limit', () => {
    expect(() => largeAmount([], '3000.0001')).toThrow(/Invalid LARGE_AMOUNT limit/);
  });
});

describe('HIGH_RISK_COUNTRY', () => {
  const countries: HighRiskCountry[] = [
    { country_code: 'XB', country_name: 'Belvaria', reason: 'Fictional: under increased monitoring' },
    { country_code: 'XD', country_name: 'Drovania', reason: 'Fictional: high-risk third country' },
  ];

  it('flags a listed country and names the country and why it is listed', () => {
    const flags = highRiskCountry([txn('T1', AT, { counterparty_country: 'XB' })], countries);
    expect(flags).toHaveLength(1);
    expect(flags[0].reason).toBe('HIGH_RISK_COUNTRY: XB Belvaria (Fictional: under increased monitoring)');
    expect(flags[0].details).toEqual({
      country_code: 'XB',
      country_name: 'Belvaria',
      list_reason: 'Fictional: under increased monitoring',
    });
  });

  it('does not flag a country that is not on the list', () => {
    expect(highRiskCountry([txn('T1', AT, { counterparty_country: 'KW' })], countries)).toEqual([]);
  });

  it('skips a transaction with no country', () => {
    expect(highRiskCountry([txn('T1', AT, { counterparty_country: null })], countries)).toEqual([]);
  });

  it('matches codes with the wrong case or extra spaces', () => {
    const flags = highRiskCountry(
      [txn('T1', AT, { counterparty_country: 'xd' }), txn('T2', AT, { counterparty_country: ' xb ' })],
      countries,
    );
    expect(flags.map((f) => f.transaction_id)).toEqual(['T1', 'T2']);
  });

  it('flags nothing when the list is empty', () => {
    expect(highRiskCountry([txn('T1', AT, { counterparty_country: 'XB' })], [])).toEqual([]);
  });
});
