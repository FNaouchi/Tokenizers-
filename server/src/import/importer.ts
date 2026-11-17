import type Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';
import { parseKwdToFils } from '../money.js';
import { parseTimestamp } from '../time.js';

export interface ImportPaths {
  transactions: string;
  accounts: string;
  highRiskCountries: string;
}

export interface ImportReport {
  rows_read: number;
  rows_loaded: number;
  duplicates_dropped: number;
  rows_rejected: number;
  missing_amount: number;
  missing_country: number;
  country_normalised: number;
  utc_timestamps: number;
}

type CsvRecord = Record<string, string>;

const SEGMENTS = new Set(['RETAIL', 'SME', 'CORPORATE']);
const DIRECTIONS = new Set(['DEBIT', 'CREDIT']);
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const REQUIRED_TRANSACTION_FIELDS = [
  'transaction_id',
  'timestamp',
  'account_id',
  'direction',
  'transaction_type',
  'channel',
  'currency',
  'counterparty_id',
] as const;

/** Normalises a country code: trims spaces and upper-cases it. */
export function normaliseCountry(code: string): string {
  return code.trim().toUpperCase();
}

function readCsv(path: string): CsvRecord[] {
  return parse(readFileSync(path, 'utf8'), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  }) as CsvRecord[];
}

function trimmed(record: CsvRecord): CsvRecord {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, (value ?? '').trim()]));
}

/**
 * Loads the three CSVs into an empty schema. Every input row ends up loaded, dropped as an
 * identical duplicate or rejected, and each drop or rejection is recorded in import_rejects.
 */
export function importAll(db: Database.Database, paths: ImportPaths): ImportReport {
  const insertReject = db.prepare('INSERT INTO import_rejects (file, source_row, reason, raw) VALUES (?, ?, ?, ?)');
  const reject = (file: string, sourceRow: number, reason: string, raw: CsvRecord) =>
    insertReject.run(file, sourceRow, reason, JSON.stringify(raw));

  const run = db.transaction((): ImportReport => {
    loadAccounts(db, paths.accounts, reject);
    loadHighRiskCountries(db, paths.highRiskCountries, reject);
    const report = loadTransactions(db, paths.transactions, reject);
    db.prepare(
      `INSERT INTO import_report (id, rows_read, rows_loaded, duplicates_dropped, rows_rejected,
         missing_amount, missing_country, country_normalised, utc_timestamps)
       VALUES (1, @rows_read, @rows_loaded, @duplicates_dropped, @rows_rejected,
         @missing_amount, @missing_country, @country_normalised, @utc_timestamps)`,
    ).run(report);
    return report;
  });
  return run();
}

type RejectFn = (file: string, sourceRow: number, reason: string, raw: CsvRecord) => unknown;

function loadAccounts(db: Database.Database, path: string, reject: RejectFn): void {
  const insert = db.prepare(
    'INSERT INTO accounts (account_id, customer_id, customer_segment, home_branch, opened_on) VALUES (?, ?, ?, ?, ?)',
  );
  const seen = new Set<string>();
  readCsv(path).forEach((raw, index) => {
    const row = index + 2;
    const rec = trimmed(raw);
    const segment = rec.customer_segment.toUpperCase();
    if (!rec.account_id || !rec.customer_id || !rec.home_branch || !rec.opened_on) {
      return reject('accounts.csv', row, 'MISSING_FIELD', raw);
    }
    if (!SEGMENTS.has(segment)) return reject('accounts.csv', row, 'INVALID_SEGMENT', raw);
    if (seen.has(rec.account_id)) return reject('accounts.csv', row, 'DUPLICATE_ACCOUNT', raw);
    seen.add(rec.account_id);
    insert.run(rec.account_id, rec.customer_id, segment, rec.home_branch, rec.opened_on);
  });
}

function loadHighRiskCountries(db: Database.Database, path: string, reject: RejectFn): void {
  const insert = db.prepare('INSERT INTO high_risk_countries (country_code, country_name, reason) VALUES (?, ?, ?)');
  const seen = new Set<string>();
  readCsv(path).forEach((raw, index) => {
    const row = index + 2;
    const rec = trimmed(raw);
    const code = normaliseCountry(rec.country_code);
    if (!COUNTRY_PATTERN.test(code)) return reject('high_risk_countries.csv', row, 'INVALID_COUNTRY_CODE', raw);
    if (!rec.country_name || !rec.reason) return reject('high_risk_countries.csv', row, 'MISSING_FIELD', raw);
    if (seen.has(code)) return reject('high_risk_countries.csv', row, 'DUPLICATE_COUNTRY', raw);
    seen.add(code);
    insert.run(code, rec.country_name, rec.reason);
  });
}

function loadTransactions(db: Database.Database, path: string, reject: RejectFn): ImportReport {
  const file = 'transactions.csv';
  const accountIds = new Set(
    (db.prepare('SELECT account_id FROM accounts').all() as { account_id: string }[]).map((a) => a.account_id),
  );
  const insert = db.prepare(
    `INSERT INTO transactions (transaction_id, ts_epoch_ms, ts_original, account_id, direction, transaction_type,
       channel, amount, currency, amount_kwd_fils, counterparty_id, counterparty_country, source_row, dq_notes)
     VALUES (@transaction_id, @ts_epoch_ms, @ts_original, @account_id, @direction, @transaction_type,
       @channel, @amount, @currency, @amount_kwd_fils, @counterparty_id, @counterparty_country, @source_row, @dq_notes)`,
  );

  const report: ImportReport = {
    rows_read: 0,
    rows_loaded: 0,
    duplicates_dropped: 0,
    rows_rejected: 0,
    missing_amount: 0,
    missing_country: 0,
    country_normalised: 0,
    utc_timestamps: 0,
  };
  const loadedById = new Map<string, string>();

  const rejectRow = (row: number, reason: string, raw: CsvRecord) => {
    report.rows_rejected += 1;
    reject(file, row, reason, raw);
  };

  readCsv(path).forEach((raw, index) => {
    const row = index + 2;
    report.rows_read += 1;
    const rec = trimmed(raw);

    const missing = REQUIRED_TRANSACTION_FIELDS.find((field) => rec[field] === '');
    if (missing) return rejectRow(row, `MISSING_FIELD:${missing}`, raw);
    if (!DIRECTIONS.has(rec.direction)) return rejectRow(row, 'INVALID_DIRECTION', raw);
    if (!accountIds.has(rec.account_id)) return rejectRow(row, 'UNKNOWN_ACCOUNT', raw);

    const timestamp = parseTimestamp(rec.timestamp);
    if (!timestamp) return rejectRow(row, 'INVALID_TIMESTAMP', raw);

    const previous = loadedById.get(rec.transaction_id);
    const fingerprint = JSON.stringify(rec);
    if (previous !== undefined) {
      if (previous === fingerprint) {
        report.duplicates_dropped += 1;
        reject(file, row, 'DUPLICATE_IDENTICAL', raw);
      } else {
        rejectRow(row, 'DUPLICATE_CONFLICT', raw);
      }
      return;
    }

    const notes: string[] = [];

    let amountKwdFils: number | null = null;
    if (rec.amount_kwd === '') {
      notes.push('MISSING_AMOUNT');
    } else {
      amountKwdFils = parseKwdToFils(rec.amount_kwd);
      if (amountKwdFils === null) return rejectRow(row, 'INVALID_AMOUNT', raw);
    }

    let country: string | null = null;
    if (rec.counterparty_country === '') {
      notes.push('MISSING_COUNTRY');
    } else {
      country = normaliseCountry(rec.counterparty_country);
      if (!COUNTRY_PATTERN.test(country)) return rejectRow(row, 'INVALID_COUNTRY_CODE', raw);
      if (country !== raw.counterparty_country) notes.push('COUNTRY_NORMALISED');
    }

    if (timestamp.isUtcSuffix) notes.push('UTC_TIMESTAMP');

    insert.run({
      transaction_id: rec.transaction_id,
      ts_epoch_ms: timestamp.epochMs,
      ts_original: rec.timestamp,
      account_id: rec.account_id,
      direction: rec.direction,
      transaction_type: rec.transaction_type,
      channel: rec.channel,
      amount: rec.amount === '' ? null : rec.amount,
      currency: rec.currency,
      amount_kwd_fils: amountKwdFils,
      counterparty_id: rec.counterparty_id,
      counterparty_country: country,
      source_row: row,
      dq_notes: JSON.stringify(notes),
    });
    loadedById.set(rec.transaction_id, fingerprint);

    report.rows_loaded += 1;
    if (notes.includes('MISSING_AMOUNT')) report.missing_amount += 1;
    if (notes.includes('MISSING_COUNTRY')) report.missing_country += 1;
    if (notes.includes('COUNTRY_NORMALISED')) report.country_normalised += 1;
    if (notes.includes('UTC_TIMESTAMP')) report.utc_timestamps += 1;
  });

  return report;
}
