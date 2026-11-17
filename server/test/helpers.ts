import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { loadConfig, type RulesConfig } from '../src/config.js';
import { createFreshDatabase } from '../src/db.js';
import { importAll, type ImportReport } from '../src/import/importer.js';
import { applyRules } from '../src/rules/engine.js';
import type { RuleTransaction } from '../src/rules/types.js';
import { parseTimestamp } from '../src/time.js';

/** Builds a RuleTransaction. `at` is an ISO timestamp (offset or Z), so tests read like the data. */
export function txn(
  id: string,
  at: string,
  overrides: Partial<Omit<RuleTransaction, 'transaction_id' | 'ts_epoch_ms'>> = {},
): RuleTransaction {
  const parsed = parseTimestamp(at);
  if (!parsed) throw new Error(`Bad test timestamp ${at}`);
  return {
    transaction_id: id,
    account_id: 'ACC-100001',
    ts_epoch_ms: parsed.epochMs,
    amount_kwd_fils: 10_000,
    counterparty_country: 'KW',
    ...overrides,
  };
}

/** Builds `count` transactions on one account at `startAt` plus each offset in seconds. */
export function burst(prefix: string, startAt: string, offsetsSeconds: number[], account = 'ACC-100001'): RuleTransaction[] {
  const start = parseTimestamp(startAt)!.epochMs;
  return offsetsSeconds.map((seconds, index) => ({
    transaction_id: `${prefix}-${index + 1}`,
    account_id: account,
    ts_epoch_ms: start + seconds * 1000,
    amount_kwd_fils: 10_000,
    counterparty_country: 'KW',
  }));
}

export const TRANSACTION_HEADER =
  'transaction_id,timestamp,account_id,direction,transaction_type,channel,amount,currency,amount_kwd,counterparty_id,counterparty_country';

/** A valid transaction CSV row. Pass overrides to break one field. */
export function csvRow(overrides: Partial<Record<string, string>> = {}): string {
  const row: Record<string, string> = {
    transaction_id: 'TXN-000001',
    timestamp: '2026-10-01T10:00:00+03:00',
    account_id: 'ACC-100001',
    direction: 'DEBIT',
    transaction_type: 'TRANSFER_DOMESTIC',
    channel: 'ONLINE',
    amount: '100.000',
    currency: 'KWD',
    amount_kwd: '100.000',
    counterparty_id: 'CP-1',
    counterparty_country: 'KW',
    ...overrides,
  };
  return TRANSACTION_HEADER.split(',').map((column) => row[column]).join(',');
}

export interface FixtureFiles {
  transactions: string[];
  accounts?: string[];
  highRisk?: string[];
}

const DEFAULT_ACCOUNTS = [
  'ACC-100001,CUS-1,RETAIL,Jahra,2020-01-01',
  'ACC-100002,CUS-2,SME,Hawalli,2021-02-02',
];
const DEFAULT_HIGH_RISK = ['XB,Belvaria,Fictional: under increased monitoring'];

/** Imports small inline CSV fixtures into a fresh in-memory database. */
export function importFixture(files: FixtureFiles): { db: Database.Database; report: ImportReport } {
  const dir = mkdtempSync(join(tmpdir(), 'aml-fixture-'));
  const write = (name: string, header: string, rows: string[]) => {
    const path = join(dir, name);
    writeFileSync(path, [header, ...rows].join('\n') + '\n');
    return path;
  };
  const db = createFreshDatabase(':memory:');
  const report = importAll(db, {
    transactions: write('transactions.csv', TRANSACTION_HEADER, files.transactions),
    accounts: write('accounts.csv', 'account_id,customer_id,customer_segment,home_branch,opened_on', files.accounts ?? DEFAULT_ACCOUNTS),
    highRiskCountries: write('high_risk_countries.csv', 'country_code,country_name,reason', files.highRisk ?? DEFAULT_HIGH_RISK),
  });
  return { db, report };
}

export const DATA_DIR = resolve(import.meta.dirname, '../../data');

/** The default config from config/rules.json, ignoring any AML_* environment variables. */
export function defaultConfig(): RulesConfig {
  return loadConfig({ env: {} });
}

/** Imports the real CSVs into an in-memory database and applies the default rules. */
export function loadRealDatabase(): { db: Database.Database; report: ImportReport; config: RulesConfig } {
  const config = defaultConfig();
  const db = createFreshDatabase(':memory:');
  const report = importAll(db, {
    transactions: join(DATA_DIR, 'transactions.csv'),
    accounts: join(DATA_DIR, 'accounts.csv'),
    highRiskCountries: config.highRiskCountriesPath,
  });
  applyRules(db, config);
  return { db, report, config };
}
