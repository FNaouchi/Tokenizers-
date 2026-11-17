import type { Flag, HighRiskCountry, RuleTransaction } from './types.js';

/** Flags transactions whose counterparty country is on the high-risk list. Missing countries are skipped. */
export function highRiskCountry(transactions: RuleTransaction[], countries: HighRiskCountry[]): Flag[] {
  const byCode = new Map(countries.map((c) => [c.country_code.trim().toUpperCase(), c]));

  const flags: Flag[] = [];
  for (const txn of transactions) {
    if (txn.counterparty_country === null) continue;
    const match = byCode.get(txn.counterparty_country.trim().toUpperCase());
    if (!match) continue;
    flags.push({
      transaction_id: txn.transaction_id,
      rule_id: 'HIGH_RISK_COUNTRY',
      reason: `HIGH_RISK_COUNTRY: ${match.country_code} ${match.country_name} (${match.reason})`,
      details: {
        country_code: match.country_code,
        country_name: match.country_name,
        list_reason: match.reason,
      },
    });
  }
  return flags;
}
