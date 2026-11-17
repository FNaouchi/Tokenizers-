import { formatKuwaitTime } from '../time.js';
import type { Flag, RuleTransaction } from './types.js';

export interface VelocityLimits {
  minCount: number;
  windowMinutes: number;
}

interface Window {
  first: number;
  last: number;
}

/**
 * Flags transactions on the same account that are close together in time.
 *
 * A window is a run of an account's transactions, sorted by UTC time, whose first-to-last span is at most
 * windowMinutes (a span of exactly windowMinutes counts). Every transaction in any window with at least
 * minCount transactions is flagged. Its reason describes the largest such window that contains it.
 */
export function velocity(transactions: RuleTransaction[], limits: VelocityLimits): Flag[] {
  const windowMs = limits.windowMinutes * 60_000;
  const byAccount = new Map<string, RuleTransaction[]>();
  for (const txn of transactions) {
    const list = byAccount.get(txn.account_id);
    if (list) list.push(txn);
    else byAccount.set(txn.account_id, [txn]);
  }

  const flags: Flag[] = [];
  for (const list of byAccount.values()) {
    list.sort((a, b) => a.ts_epoch_ms - b.ts_epoch_ms || a.transaction_id.localeCompare(b.transaction_id));
    const best = largestWindows(list, limits.minCount, windowMs);

    list.forEach((txn, index) => {
      const window = best.get(index);
      if (!window) return;
      const members = list.slice(window.first, window.last + 1);
      const spanSeconds = (list[window.last].ts_epoch_ms - list[window.first].ts_epoch_ms) / 1000;
      const spanMinutes = Math.floor(spanSeconds / 60);
      flags.push({
        transaction_id: txn.transaction_id,
        rule_id: 'VELOCITY',
        reason: `VELOCITY: ${members.length} transactions in ${spanMinutes} min (limit: ${limits.minCount} in ${limits.windowMinutes} min)`,
        details: {
          count: members.length,
          span_seconds: spanSeconds,
          window_start: formatKuwaitTime(list[window.first].ts_epoch_ms),
          window_end: formatKuwaitTime(list[window.last].ts_epoch_ms),
          limit_count: limits.minCount,
          limit_window_minutes: limits.windowMinutes,
          related_transaction_ids: members.filter((m) => m !== txn).map((m) => m.transaction_id),
        },
      });
    });
  }
  return flags;
}

/** For each index covered by a qualifying window, returns the qualifying window with the most transactions. */
function largestWindows(sorted: RuleTransaction[], minCount: number, windowMs: number): Map<number, Window> {
  const best = new Map<number, Window>();
  let last = 0;
  for (let first = 0; first < sorted.length; first++) {
    if (last < first) last = first;
    while (last + 1 < sorted.length && sorted[last + 1].ts_epoch_ms - sorted[first].ts_epoch_ms <= windowMs) last++;
    if (last - first + 1 < minCount) continue;

    const size = last - first + 1;
    for (let k = first; k <= last; k++) {
      const current = best.get(k);
      if (!current || size > current.last - current.first + 1) best.set(k, { first, last });
    }
  }
  return best;
}
