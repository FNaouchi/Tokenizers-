export type RuleId = 'LARGE_AMOUNT' | 'VELOCITY' | 'HIGH_RISK_COUNTRY';

export const RULE_IDS: readonly RuleId[] = ['LARGE_AMOUNT', 'VELOCITY', 'HIGH_RISK_COUNTRY'];

/** The fields the rules need. Loaded transactions are already de-duplicated and normalised by the importer. */
export interface RuleTransaction {
  transaction_id: string;
  account_id: string;
  /** UTC instant in milliseconds. */
  ts_epoch_ms: number;
  /** Integer fils (KWD x 1000), or null when the amount was missing. */
  amount_kwd_fils: number | null;
  /** Upper-case ISO alpha-2 code, or null when missing. */
  counterparty_country: string | null;
}

export interface HighRiskCountry {
  country_code: string;
  country_name: string;
  reason: string;
}

export interface Flag {
  transaction_id: string;
  rule_id: RuleId;
  /** One readable line with the actual value and the limit. */
  reason: string;
  details: Record<string, unknown>;
}
