import type { Response } from 'express';
import { RULE_IDS, type RuleId } from '../rules/types.js';

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

export interface FlagsQuery extends AccountFilter {
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

  const account_id = parseAccount(query.account_id, errors);
  const limit = parseInteger('limit', query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, errors);
  const offset = parseInteger('offset', query.offset, 0, 0, Number.MAX_SAFE_INTEGER, errors);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { rule, sort, account_id, limit, offset } };
}

export function parseSummaryQuery(query: RawQuery): Parsed<AccountFilter> {
  const errors: ErrorDetail[] = [];
  const account_id = parseAccount(query.account_id, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { account_id } };
}

export function parseNotAssessedQuery(query: RawQuery): Parsed<AccountFilter & { limit: number; offset: number }> {
  const errors: ErrorDetail[] = [];
  const account_id = parseAccount(query.account_id, errors);
  const limit = parseInteger('limit', query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, errors);
  const offset = parseInteger('offset', query.offset, 0, 0, Number.MAX_SAFE_INTEGER, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { account_id, limit, offset } };
}
