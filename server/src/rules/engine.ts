import type Database from 'better-sqlite3';
import type { RulesConfig } from '../config.js';
import { highRiskCountry } from './highRiskCountry.js';
import { largeAmount } from './largeAmount.js';
import { RULE_IDS, type Flag, type HighRiskCountry, type RuleId, type RuleTransaction } from './types.js';
import { velocity } from './velocity.js';

export interface RuleSummary {
  by_rule: Record<RuleId, number>;
  flagged_transactions: number;
}

/** Runs all three rules over the given transactions. Limits come from the config, never from code. */
export function evaluateRules(
  transactions: RuleTransaction[],
  countries: HighRiskCountry[],
  config: Pick<RulesConfig, 'largeAmountKwd' | 'velocity'>,
): Flag[] {
  return [
    ...largeAmount(transactions, config.largeAmountKwd),
    ...velocity(transactions, config.velocity),
    ...highRiskCountry(transactions, countries),
  ];
}

/** Evaluates the rules on the database and replaces the stored flags, so it is safe to run again. */
export function applyRules(db: Database.Database, config: RulesConfig): RuleSummary {
  const transactions = db
    .prepare(
      'SELECT transaction_id, account_id, ts_epoch_ms, amount_kwd_fils, counterparty_country FROM transactions',
    )
    .all() as RuleTransaction[];
  const countries = db
    .prepare('SELECT country_code, country_name, reason FROM high_risk_countries')
    .all() as HighRiskCountry[];

  const flags = evaluateRules(transactions, countries, config);

  const insert = db.prepare('INSERT INTO flags (transaction_id, rule_id, reason, details) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM flags').run();
    for (const flag of flags) insert.run(flag.transaction_id, flag.rule_id, flag.reason, JSON.stringify(flag.details));
  })();

  return summarise(flags);
}

export function summarise(flags: Flag[]): RuleSummary {
  const by_rule = Object.fromEntries(RULE_IDS.map((id) => [id, 0])) as Record<RuleId, number>;
  for (const flag of flags) by_rule[flag.rule_id] += 1;
  return { by_rule, flagged_transactions: new Set(flags.map((f) => f.transaction_id)).size };
}
