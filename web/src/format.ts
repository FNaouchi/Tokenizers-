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

const TYPE_WORDS: Record<string, string> = {
  CARD_PAYMENT: 'card payment',
  CASH_DEPOSIT: 'cash deposit',
  CASH_WITHDRAWAL: 'cash withdrawal',
  TRANSFER_DOMESTIC: 'domestic transfer',
  TRANSFER_INTERNATIONAL: 'international transfer',
};

const CHANNEL_WORDS: Record<string, string> = {
  ATM: 'at an ATM',
  BRANCH: 'at a branch',
  MOBILE: 'in the mobile app',
  ONLINE: 'online',
  POS: 'at a point of sale',
};

const plain = (code: string) => code.toLowerCase().replace(/_/g, ' ');

/** "DEBIT · TRANSFER_INTERNATIONAL · BRANCH" -> "Debit · international transfer · at a branch". */
export function describeTransaction(direction: string, type: string, channel: string): string {
  const first = plain(direction);
  return [first.charAt(0).toUpperCase() + first.slice(1), TYPE_WORDS[type] ?? plain(type), CHANNEL_WORDS[channel] ?? plain(channel)].join(' · ');
}

export const DATA_QUALITY_NOTES: Record<string, { label: string; explanation: string }> = {
  COUNTRY_NORMALISED: {
    label: 'Country code was fixed on import',
    explanation: 'The country code had different capitals or extra spaces in the file, so it was tidied up before the high-risk country check.',
  },
  UTC_TIMESTAMP: {
    label: 'Time was converted from UTC',
    explanation: 'This record arrived with a UTC time. It was converted to Kuwait time (UTC+03:00) so it sorts and groups correctly.',
  },
  MISSING_AMOUNT: {
    label: 'Amount is missing',
    explanation: 'The file had no amount for this transaction, so the large amount rule could not check it.',
  },
  MISSING_COUNTRY: {
    label: 'Country is missing',
    explanation: 'The file had no counterparty country, so the high-risk country rule could not check it.',
  },
  INVALID_COUNTRY: {
    label: 'Country code is not usable',
    explanation: 'The country value was not a 2-letter code, so it was not stored and the high-risk country rule could not check it.',
  },
};

export function dataQualityNote(note: string): { label: string; explanation: string } {
  return DATA_QUALITY_NOTES[note] ?? { label: plain(note), explanation: 'Data-quality note from the import.' };
}
