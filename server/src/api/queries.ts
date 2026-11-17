import type Database from 'better-sqlite3';
import { formatFils } from '../money.js';
import { formatKuwaitTime, kuwaitDayStartMs } from '../time.js';
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

export const CUSTOMER_SEGMENTS = ['RETAIL', 'SME', 'CORPORATE'] as const;

/** Filters on the transaction or its account. Dates are Kuwait calendar days, both ends included. */
export interface TransactionFilters {
  account_id?: string;
  date_from?: string;
  date_to?: string;
  segment?: string;
  branch?: string;
  min_amount_fils?: number;
}

export interface FlagFilters extends TransactionFilters {
  rule?: RuleId;
}

export interface Page {
  limit: number;
  offset: number;
}

type SqlParams = Record<string, string | number>;

/** Builds the SQL conditions for the transaction filters (on aliases t and a), with named parameters. */
function transactionConditions(filters: TransactionFilters): { conditions: string[]; params: SqlParams } {
  const conditions: string[] = [];
  const params: SqlParams = {};
  if (filters.account_id) {
    conditions.push('t.account_id = @account_id');
    params.account_id = filters.account_id;
  }
  if (filters.date_from) {
    const start = kuwaitDayStartMs(filters.date_from);
    if (start !== null) {
      conditions.push('t.ts_epoch_ms >= @from_ms');
      params.from_ms = start;
    }
  }
  if (filters.date_to) {
    const start = kuwaitDayStartMs(filters.date_to);
    if (start !== null) {
      conditions.push('t.ts_epoch_ms < @to_ms');
      params.to_ms = start + 24 * 60 * 60 * 1000;
    }
  }
  if (filters.segment) {
    conditions.push('a.customer_segment = @segment');
    params.segment = filters.segment;
  }
  if (filters.branch) {
    conditions.push('a.home_branch = @branch');
    params.branch = filters.branch;
  }
  if (filters.min_amount_fils !== undefined) {
    conditions.push('t.amount_kwd_fils >= @min_amount_fils');
    params.min_amount_fils = filters.min_amount_fils;
  }
  return { conditions, params };
}

/** Builds the WHERE clause for "transactions that fired a rule", with named parameters. */
function flaggedWhere(filters: FlagFilters): { where: string; params: SqlParams } {
  const { conditions, params } = transactionConditions(filters);
  let flagCondition = 'f.transaction_id = t.transaction_id';
  if (filters.rule) {
    flagCondition += ' AND f.rule_id = @rule';
    params.rule = filters.rule;
  }
  const where = [`EXISTS (SELECT 1 FROM flags f WHERE ${flagCondition})`, ...conditions].join(' AND ');
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

const NEWEST_FIRST = 't.ts_epoch_ms DESC, t.transaction_id DESC';
const MOST_FLAGS_FIRST = `(SELECT COUNT(*) FROM flags fc WHERE fc.transaction_id = t.transaction_id) DESC, ${NEWEST_FIRST}`;

/** Flagged transactions, newest first or most flags first. Each appears once with every rule that fired. */
export function listFlagged(
  db: Database.Database,
  filters: FlagFilters,
  page: Page,
  sort: 'newest' | 'most_flags' = 'newest',
) {
  const { where, params } = flaggedWhere(filters);
  return listPage(db, where, params, page, sort === 'most_flags' ? MOST_FLAGS_FIRST : NEWEST_FIRST);
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
  const params: SqlParams = {};
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

function listPage(
  db: Database.Database,
  where: string,
  params: SqlParams,
  page: Page,
  orderBy: string = NEWEST_FIRST,
) {
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM transactions t JOIN accounts a ON a.account_id = t.account_id WHERE ${where}`)
      .get(params) as { n: number }
  ).n;
  const rows = db
    .prepare(
      `SELECT ${TRANSACTION_COLUMNS}
       FROM transactions t JOIN accounts a ON a.account_id = t.account_id
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: page.limit, offset: page.offset }) as TransactionRow[];
  return { items: attachFlags(db, rows), total, limit: page.limit, offset: page.offset };
}

/** Flag counts for the transactions that match the filters. Every filter applies to every count. */
export function flagSummary(db: Database.Database, filters: TransactionFilters = {}) {
  const { conditions, params } = transactionConditions(filters);
  const and = conditions.map((c) => ` AND ${c}`).join('');
  const from = 'transactions t JOIN accounts a ON a.account_id = t.account_id';

  const by_rule = Object.fromEntries(RULE_IDS.map((id) => [id, 0])) as Record<RuleId, number>;
  const counts = db
    .prepare(
      `SELECT f.rule_id, COUNT(*) AS n FROM flags f JOIN transactions t ON t.transaction_id = f.transaction_id JOIN accounts a ON a.account_id = t.account_id
       WHERE 1 = 1${and} GROUP BY f.rule_id`,
    )
    .all(params) as { rule_id: RuleId; n: number }[];
  for (const { rule_id, n } of counts) by_rule[rule_id] = n;

  const flagged_transactions = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT f.transaction_id) AS n FROM flags f JOIN transactions t ON t.transaction_id = f.transaction_id JOIN accounts a ON a.account_id = t.account_id
         WHERE 1 = 1${and}`,
      )
      .get(params) as { n: number }
  ).n;
  const total_transactions = (
    db.prepare(`SELECT COUNT(*) AS n FROM ${from} WHERE 1 = 1${and}`).get(params) as { n: number }
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

/** The segments and branches that exist in the loaded accounts, for the dashboard's filter lists. */
export function getFilterOptions(db: Database.Database) {
  const branches = (db.prepare('SELECT DISTINCT home_branch FROM accounts ORDER BY home_branch').all() as { home_branch: string }[]).map(
    (row) => row.home_branch,
  );
  return { customer_segments: [...CUSTOMER_SEGMENTS], branches };
}
