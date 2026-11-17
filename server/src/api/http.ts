import type { Response } from 'express';
import { parseKwdToFils } from '../money.js';
import { RULE_IDS, type RuleId } from '../rules/types.js';
import { kuwaitDayStartMs } from '../time.js';
import { CUSTOMER_SEGMENTS, type TransactionFilters } from './queries.js';

export interface ErrorDetail {
  field: string;
  problem: string;
  value?: unknown;
}

export function sendValidationError(res: Response, details: ErrorDetail[]): void {
  const count = details.length;
  res.status(400).json({
    error: {
      code: 'VALIDATION_FAILED',
      message: `The request has ${count} invalid ${count === 1 ? 'field' : 'fields'}.`,
      details,
    },
  });
}

export function sendNotFound(res: Response, message: string): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message, details: [] } });
}

export function sendBadRequest(res: Response): void {
  res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'The request could not be read.', details: [] } });
}

export function sendInternalError(res: Response): void {
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', details: [] } });
}

const ACCOUNT_PATTERN = /^ACC-\d+$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

type RawQuery = Record<string, unknown>;

export interface AccountFilter {
  account_id?: string;
}

export const FLAG_SORTS = ['newest', 'most_flags'] as const;
export type FlagSort = (typeof FLAG_SORTS)[number];

export interface FlagsQuery extends TransactionFilters {
  rule?: RuleId;
  sort: FlagSort;
  limit: number;
  offset: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: ErrorDetail[] };

function parseAccount(raw: unknown, errors: ErrorDetail[]): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !ACCOUNT_PATTERN.test(raw)) {
    errors.push({ field: 'account_id', problem: 'Must look like ACC-100001.', value: raw });
    return undefined;
  }
  return raw;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(field: string, raw: unknown, errors: ErrorDetail[]): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !DATE_PATTERN.test(raw) || kuwaitDayStartMs(raw) === null) {
    errors.push({ field, problem: 'Must be a real date like 2026-10-25.', value: raw });
    return undefined;
  }
  return raw;
}

/** Reads the filters shared by the flags list and the summary. */
function parseTransactionFilters(query: RawQuery, errors: ErrorDetail[]): TransactionFilters {
  const account_id = parseAccount(query.account_id, errors);
  const date_from = parseDate('date_from', query.date_from, errors);
  const date_to = parseDate('date_to', query.date_to, errors);
  if (date_from && date_to && date_from > date_to) {
    errors.push({ field: 'date_to', problem: 'Must not be before date_from.', value: query.date_to });
  }

  let segment: string | undefined;
  if (query.segment !== undefined) {
    if (typeof query.segment === 'string' && (CUSTOMER_SEGMENTS as readonly string[]).includes(query.segment)) {
      segment = query.segment;
    } else {
      errors.push({ field: 'segment', problem: `Must be one of ${CUSTOMER_SEGMENTS.join(', ')}.`, value: query.segment });
    }
  }

  let branch: string | undefined;
  if (query.branch !== undefined) {
    if (typeof query.branch !== 'string' || query.branch.trim() === '' || query.branch.length > 100) {
      errors.push({ field: 'branch', problem: 'Must be a branch name, up to 100 characters.', value: query.branch });
    } else {
      branch = query.branch;
    }
  }

  let min_amount_fils: number | undefined;
  if (query.min_amount_kwd !== undefined) {
    const fils = typeof query.min_amount_kwd === 'string' ? parseKwdToFils(query.min_amount_kwd) : null;
    if (fils === null) {
      errors.push({ field: 'min_amount_kwd', problem: 'Must be an amount like 3000 or 3000.500 (at most 3 decimals).', value: query.min_amount_kwd });
    } else {
      min_amount_fils = fils;
    }
  }

  return { account_id, date_from, date_to, segment, branch, min_amount_fils };
}

function parseInteger(
  field: string,
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
  errors: ErrorDetail[],
): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `${min} or more` : `from ${min} to ${max}`;
    errors.push({ field, problem: `Must be a whole number ${range}.`, value: raw });
    return fallback;
  }
  return Number(raw);
}

export function parseFlagsQuery(query: RawQuery): Parsed<FlagsQuery> {
  const errors: ErrorDetail[] = [];

  let rule: RuleId | undefined;
  if (query.rule !== undefined) {
    if (typeof query.rule === 'string' && (RULE_IDS as readonly string[]).includes(query.rule)) {
      rule = query.rule as RuleId;
    } else {
      errors.push({ field: 'rule', problem: `Must be one of ${RULE_IDS.join(', ')}.`, value: query.rule });
    }
  }

  let sort: FlagSort = 'newest';
  if (query.sort !== undefined) {
    if (typeof query.sort === 'string' && (FLAG_SORTS as readonly string[]).includes(query.sort)) {
      sort = query.sort as FlagSort;
    } else {
      errors.push({ field: 'sort', problem: `Must be one of ${FLAG_SORTS.join(', ')}.`, value: query.sort });
    }
  }

  const filters = parseTransactionFilters(query, errors);
  const limit = parseInteger('limit', query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, errors);
  const offset = parseInteger('offset', query.offset, 0, 0, Number.MAX_SAFE_INTEGER, errors);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { rule, sort, ...filters, limit, offset } };
}

export function parseSummaryQuery(query: RawQuery): Parsed<TransactionFilters> {
  const errors: ErrorDetail[] = [];
  const filters = parseTransactionFilters(query, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: filters };
}

export function parseNotAssessedQuery(query: RawQuery): Parsed<AccountFilter & { limit: number; offset: number }> {
  const errors: ErrorDetail[] = [];
  const account_id = parseAccount(query.account_id, errors);
  const limit = parseInteger('limit', query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, errors);
  const offset = parseInteger('offset', query.offset, 0, 0, Number.MAX_SAFE_INTEGER, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { account_id, limit, offset } };
}
