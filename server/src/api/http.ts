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
  res.status(404).json({ error: { code: 'NOT_FOUND', message } });
}

const ACCOUNT_PATTERN = /^ACC-\d+$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

type RawQuery = Record<string, unknown>;

export interface AccountFilter {
  account_id?: string;
}

export interface FlagsQuery extends AccountFilter {
  rule?: RuleId;
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

  const account_id = parseAccount(query.account_id, errors);
  const limit = parseInteger('limit', query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, errors);
  const offset = parseInteger('offset', query.offset, 0, 0, Number.MAX_SAFE_INTEGER, errors);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { rule, account_id, limit, offset } };
}

export function parseSummaryQuery(query: RawQuery): Parsed<AccountFilter> {
  const errors: ErrorDetail[] = [];
  const account_id = parseAccount(query.account_id, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { account_id } };
}
