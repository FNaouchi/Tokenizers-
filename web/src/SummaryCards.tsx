import { RULE_IDS, type RuleId, type Summary } from './api';
import type { AsyncState } from './useApi';

export const RULE_LABELS: Record<RuleId, string> = {
  LARGE_AMOUNT: 'Large amount',
  VELOCITY: 'Velocity',
  HIGH_RISK_COUNTRY: 'High-risk country',
};

interface Props {
  summary: AsyncState<Summary>;
  activeRule: RuleId | undefined;
  onSelect: (rule: RuleId | undefined) => void;
}

export function SummaryCards({ summary, activeRule, onSelect }: Props) {
  const data = summary.data;
  return (
    <section aria-label="Flag counts" className="cards">
      <div className="card card-total">
        <span className="card-label">Flagged transactions</span>
        <span className="card-count">{data ? data.flagged_transactions : '–'}</span>
        <span className="card-note">{data ? `of ${data.total_transactions} transactions` : ''}</span>
      </div>
      {RULE_IDS.map((rule) => (
        <button
          key={rule}
          type="button"
          className={`card card-button rule-${rule} ${activeRule === rule ? 'active' : ''}`}
          aria-pressed={activeRule === rule}
          onClick={() => onSelect(activeRule === rule ? undefined : rule)}
        >
          <span className="card-label">{RULE_LABELS[rule]}</span>
          <span className="card-count">{data ? data.by_rule[rule] : '–'}</span>
          <span className="card-note">{rule}</span>
        </button>
      ))}
      {summary.error && <p className="error" role="alert">{summary.error}</p>}
    </section>
  );
}
