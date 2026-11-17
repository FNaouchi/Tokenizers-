export type RuleId = 'LARGE_AMOUNT' | 'VELOCITY' | 'HIGH_RISK_COUNTRY';

export type FlagSort = 'newest' | 'most_flags';

export const RULE_IDS: RuleId[] = ['LARGE_AMOUNT', 'VELOCITY', 'HIGH_RISK_COUNTRY'];

export interface Flag {
  rule_id: RuleId;
  reason: string;
  details: Record<string, unknown>;
}

export interface FlaggedTransaction {
  transaction_id: string;
  timestamp: string;
  account: { account_id: string; customer_segment: string; home_branch: string };
  direction: string;
  transaction_type: string;
  channel: string;
  amount_kwd: string | null;
  counterparty_country: string | null;
  flags: Flag[];
  data_quality: string[];
}

export interface FlagsPage {
  items: FlaggedTransaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface NotAssessedPage {
  items: (FlaggedTransaction & { not_assessed: RuleId[] })[];
  total: number;
  limit: number;
  offset: number;
}

export interface Summary {
  by_rule: Record<RuleId, number>;
  flagged_transactions: number;
  total_transactions: number;
}

export type TransactionFilters = {
  account_id?: string;
  date_from?: string;
  date_to?: string;
  segment?: string;
  branch?: string;
  min_amount_kwd?: string;
};

export interface ConfigInfo {
  customer_segments: string[];
  branches: string[];
  large_amount_kwd: string;
  velocity: { min_count: number; window_minutes: number };
  high_risk_countries: { country_code: string; country_name: string; reason: string }[];
}

export type ImportReport = Record<
  | 'rows_read'
  | 'rows_loaded'
  | 'duplicates_dropped'
  | 'rows_rejected'
  | 'missing_amount'
  | 'missing_country'
  | 'country_normalised'
  | 'invalid_country'
  | 'utc_timestamps',
  number
>;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly problems: string[] = [],
  ) {
    super(message);
  }
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.size > 0 ? `?${query}` : '';
  const response = await fetch(`/api${path}${suffix}`, { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error;
    const problems = (error?.details ?? []).map((d: { field: string; problem: string }) => `${d.field}: ${d.problem}`);
    throw new ApiError(error?.message ?? `Request failed (${response.status}).`, problems);
  }
  return body as T;
}

export const api = {
  flags: (params: TransactionFilters & { rule?: RuleId; sort?: FlagSort; limit: number; offset: number }, signal?: AbortSignal) =>
    get<FlagsPage>('/flags', params, signal),
  summary: (params: TransactionFilters, signal?: AbortSignal) => get<Summary>('/flags/summary', params, signal),
  notAssessed: (params: { account_id?: string; limit: number }, signal?: AbortSignal) =>
    get<NotAssessedPage>('/not-assessed', { ...params, offset: 0 }, signal),
  transaction: (id: string, signal?: AbortSignal) => get<FlaggedTransaction>(`/transactions/${encodeURIComponent(id)}`, {}, signal),
  config: (signal?: AbortSignal) => get<ConfigInfo>('/config', {}, signal),
  importReport: (signal?: AbortSignal) => get<ImportReport>('/import-report', {}, signal),
};
