import type Database from 'better-sqlite3';
import { formatFils } from '../money.js';
import { formatKuwaitTime } from '../time.js';
import { RULE_IDS, type RuleId } from '../rules/types.js';

export interface FlaggedTransaction {
  transaction_id: string;
  timestamp: string;
  account: { account_id: string; customer_segment: string; home_branch: string };
  direction: string;
  transaction_type: string;
  channel: string;
  amount_kwd: string | null;
  counterparty_country: string | null;
  flags: { rule_id: RuleId; reason: string; details: Record<string, unknown> }[];
  data_quality: string[];
}

interface TransactionRow {
  transaction_id: string;
  ts_epoch_ms: number;
  account_id: string;
  customer_segment: string;
  home_branch: string;
  direction: string;
  transaction_type: string;
  channel: string;
  amount_kwd_fils: number | null;
  counterparty_country: string | null;
  dq_notes: string;
}

interface FlagRow {
  transaction_id: string;
  rule_id: RuleId;
  reason: string;
  details: string;
}

const TRANSACTION_COLUMNS = `t.transaction_id, t.ts_epoch_ms, t.account_id, a.customer_segment, a.home_branch,
  t.direction, t.transaction_type, t.channel, t.amount_kwd_fils, t.counterparty_country, t.dq_notes`;

export interface FlagFilters {
  rule?: RuleId;
  account_id?: string;
}

export interface Page {
  limit: number;
  offset: number;
}

/** Builds the WHERE clause for "transactions that fired a rule", with named parameters. */
function flaggedWhere(filters: FlagFilters): { where: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  let flagCondition = 'f.transaction_id = t.transaction_id';
  if (filters.rule) {
    flagCondition += ' AND f.rule_id = @rule';
    params.rule = filters.rule;
  }
  let where = `EXISTS (SELECT 1 FROM flags f WHERE ${flagCondition})`;
  if (filters.account_id) {
    where += ' AND t.account_id = @account_id';
    params.account_id = filters.account_id;
  }
  return { where, params };
}

function attachFlags(db: Database.Database, rows: TransactionRow[]): FlaggedTransaction[] {
  const flagsById = new Map<string, FlagRow[]>();
  if (rows.length > 0) {
    const placeholders = rows.map(() => '?').join(',');
    const flagRows = db
      .prepare(`SELECT transaction_id, rule_id, reason, details FROM flags WHERE transaction_id IN (${placeholders})`)
      .all(...rows.map((r) => r.transaction_id)) as FlagRow[];
    for (const flag of flagRows) {
      const list = flagsById.get(flag.transaction_id);
      if (list) list.push(flag);
      else flagsById.set(flag.transaction_id, [flag]);
    }
  }

  return rows.map((row) => ({
    transaction_id: row.transaction_id,
    timestamp: formatKuwaitTime(row.ts_epoch_ms),
    account: { account_id: row.account_id, customer_segment: row.customer_segment, home_branch: row.home_branch },
    direction: row.direction,
    transaction_type: row.transaction_type,
    channel: row.channel,
    amount_kwd: row.amount_kwd_fils === null ? null : formatFils(row.amount_kwd_fils),
    counterparty_country: row.counterparty_country,
    flags: (flagsById.get(row.transaction_id) ?? [])
      .sort((a, b) => RULE_IDS.indexOf(a.rule_id) - RULE_IDS.indexOf(b.rule_id))
      .map((f) => ({ rule_id: f.rule_id, reason: f.reason, details: JSON.parse(f.details) as Record<string, unknown> })),
    data_quality: JSON.parse(row.dq_notes) as string[],
  }));
}

/** Flagged transactions, newest first. Each appears once with every rule that fired. */
export function listFlagged(db: Database.Database, filters: FlagFilters, page: Page) {
  const { where, params } = flaggedWhere(filters);
  return listPage(db, where, params, page);
}

/** Which rules could not be checked, given a transaction's data-quality notes. */
export function notAssessedRules(notes: string[]): RuleId[] {
  const rules: RuleId[] = [];
  if (notes.includes('MISSING_AMOUNT')) rules.push('LARGE_AMOUNT');
  if (notes.includes('MISSING_COUNTRY') || notes.includes('INVALID_COUNTRY')) rules.push('HIGH_RISK_COUNTRY');
  return rules;
}

/** Transactions a rule could not check because a value was missing or unusable, newest first. */
export function listNotAssessed(db: Database.Database, filters: { account_id?: string }, page: Page) {
  const params: Record<string, string> = {};
  let where = `EXISTS (SELECT 1 FROM json_each(t.dq_notes) WHERE json_each.value IN ('MISSING_AMOUNT','MISSING_COUNTRY','INVALID_COUNTRY'))`;
  if (filters.account_id) {
    where += ' AND t.account_id = @account_id';
    params.account_id = filters.account_id;
  }
  const result = listPage(db, where, params, page);
  return {
    ...result,
    items: result.items.map((item) => ({ ...item, not_assessed: notAssessedRules(item.data_quality) })),
  };
}

function listPage(db: Database.Database, where: string, params: Record<string, string>, page: Page) {
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM transactions t WHERE ${where}`).get(params) as { n: number }
  ).n;
  const rows = db
    .prepare(
      `SELECT ${TRANSACTION_COLUMNS}
       FROM transactions t JOIN accounts a ON a.account_id = t.account_id
       WHERE ${where}
       ORDER BY t.ts_epoch_ms DESC, t.transaction_id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: page.limit, offset: page.offset }) as TransactionRow[];
  return { items: attachFlags(db, rows), total, limit: page.limit, offset: page.offset };
}

export function flagSummary(db: Database.Database, accountId?: string) {
  const params: Record<string, string> = accountId ? { account_id: accountId } : {};
  const accountClause = accountId ? 'AND t.account_id = @account_id' : '';

  const by_rule = Object.fromEntries(RULE_IDS.map((id) => [id, 0])) as Record<RuleId, number>;
  const counts = db
    .prepare(
      `SELECT f.rule_id, COUNT(*) AS n FROM flags f JOIN transactions t ON t.transaction_id = f.transaction_id
       WHERE 1 = 1 ${accountClause} GROUP BY f.rule_id`,
    )
    .all(params) as { rule_id: RuleId; n: number }[];
  for (const { rule_id, n } of counts) by_rule[rule_id] = n;

  const flagged_transactions = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT f.transaction_id) AS n FROM flags f JOIN transactions t ON t.transaction_id = f.transaction_id
         WHERE 1 = 1 ${accountClause}`,
      )
      .get(params) as { n: number }
  ).n;
  const total_transactions = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM transactions t WHERE 1 = 1 ${accountClause}`)
      .get(params) as { n: number }
  ).n;

  return { by_rule, flagged_transactions, total_transactions };
}

/** One loaded transaction, flagged or not. Returns null if the id is unknown. */
export function getTransaction(db: Database.Database, transactionId: string): FlaggedTransaction | null {
  const row = db
    .prepare(
      `SELECT ${TRANSACTION_COLUMNS}
       FROM transactions t JOIN accounts a ON a.account_id = t.account_id
       WHERE t.transaction_id = ?`,
    )
    .get(transactionId) as TransactionRow | undefined;
  return row ? attachFlags(db, [row])[0] : null;
}

export function getImportReport(db: Database.Database): Record<string, number> | null {
  const row = db
    .prepare(
      `SELECT rows_read, rows_loaded, duplicates_dropped, rows_rejected, missing_amount, missing_country,
         country_normalised, invalid_country, utc_timestamps FROM import_report WHERE id = 1`,
    )
    .get() as Record<string, number> | undefined;
  return row ?? null;
}

export function getHighRiskCountries(db: Database.Database) {
  return db
    .prepare('SELECT country_code, country_name, reason FROM high_risk_countries ORDER BY country_code')
    .all() as { country_code: string; country_name: string; reason: string }[];
}
