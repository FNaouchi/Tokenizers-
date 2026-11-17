import { formatFils, formatFilsGrouped, parseKwdToFils } from '../money.js';
import type { Flag, RuleTransaction } from './types.js';

/** Flags transactions whose amount in KWD is greater than or equal to the limit. Missing amounts are skipped. */
export function largeAmount(transactions: RuleTransaction[], limitKwd: string): Flag[] {
  const limitFils = parseKwdToFils(limitKwd);
  if (limitFils === null) throw new Error(`Invalid LARGE_AMOUNT limit: ${limitKwd}`);

  const flags: Flag[] = [];
  for (const txn of transactions) {
    if (txn.amount_kwd_fils === null || txn.amount_kwd_fils < limitFils) continue;
    flags.push({
      transaction_id: txn.transaction_id,
      rule_id: 'LARGE_AMOUNT',
      reason: `LARGE_AMOUNT: ${formatFilsGrouped(txn.amount_kwd_fils)} KWD (limit: ≥ ${formatFilsGrouped(limitFils)} KWD)`,
      details: {
        amount_kwd: formatFils(txn.amount_kwd_fils),
        limit_kwd: formatFils(limitFils),
      },
    });
  }
  return flags;
}
