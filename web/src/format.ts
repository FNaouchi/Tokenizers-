import type { Flag } from './api';

/** Formats a decimal string from the API with thousands separators and 3 decimals: "12499.999" -> "12,499.999". */
export function formatAmount(amount: string | null): string {
  if (amount === null) return '—';
  const [whole, fraction = ''] = amount.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(3, '0').slice(0, 3)}`;
}

/** Shows what a flag measured, without repeating the rule name that the badge already shows. */
export function reasonValues(flag: Flag): string {
  const d = flag.details;
  switch (flag.rule_id) {
    case 'LARGE_AMOUNT':
      return `${formatAmount(String(d.amount_kwd))} KWD, limit ${formatAmount(String(d.limit_kwd))}`;
    case 'VELOCITY':
      return `${d.count} transactions in ${Math.floor(Number(d.span_seconds) / 60)} min, limit ${d.limit_count} in ${d.limit_window_minutes} min`;
    case 'HIGH_RISK_COUNTRY':
      return `${d.country_code} ${d.country_name} (${d.list_reason})`;
  }
}
