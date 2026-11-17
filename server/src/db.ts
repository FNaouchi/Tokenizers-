import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_DB_PATH = resolve(repoRoot, 'data/aml.db');

export const SCHEMA = `
CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  customer_segment TEXT NOT NULL CHECK (customer_segment IN ('RETAIL','SME','CORPORATE')),
  home_branch TEXT NOT NULL,
  opened_on TEXT NOT NULL
);

CREATE TABLE high_risk_countries (
  country_code TEXT PRIMARY KEY,
  country_name TEXT NOT NULL,
  reason TEXT NOT NULL
);

-- Times are stored as UTC epoch milliseconds; ts_original keeps the text from the file.
-- Money is stored as integer fils (KWD x 1000). A NULL amount_kwd_fils means the amount was missing.
CREATE TABLE transactions (
  transaction_id TEXT PRIMARY KEY,
  ts_epoch_ms INTEGER NOT NULL,
  ts_original TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(account_id),
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  transaction_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  amount TEXT,
  currency TEXT NOT NULL,
  amount_kwd_fils INTEGER,
  counterparty_id TEXT NOT NULL,
  counterparty_country TEXT,
  source_row INTEGER NOT NULL,
  dq_notes TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_transactions_account_time ON transactions(account_id, ts_epoch_ms);

CREATE TABLE import_rejects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  reason TEXT NOT NULL,
  raw TEXT NOT NULL
);

CREATE TABLE import_report (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rows_read INTEGER NOT NULL,
  rows_loaded INTEGER NOT NULL,
  duplicates_dropped INTEGER NOT NULL,
  rows_rejected INTEGER NOT NULL,
  missing_amount INTEGER NOT NULL,
  missing_country INTEGER NOT NULL,
  country_normalised INTEGER NOT NULL,
  utc_timestamps INTEGER NOT NULL
);

CREATE TABLE flags (
  transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id),
  rule_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL,
  PRIMARY KEY (transaction_id, rule_id)
);
`;

/** Deletes any existing database file and creates a fresh one with the schema, so an import is repeatable. */
export function createFreshDatabase(path: string = DEFAULT_DB_PATH): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
  }
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function openDatabase(path: string = DEFAULT_DB_PATH): Database.Database {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  return db;
}
