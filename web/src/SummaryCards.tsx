import { RULE_IDS, type ConfigInfo, type RuleId, type Summary } from './api';
import { ruleLimits } from './format';
import type { AsyncState } from './useApi';

export const RULE_LABELS: Record<RuleId, string> = {
  LARGE_AMOUNT: 'Large amount',
  VELOCITY: 'Velocity',
  HIGH_RISK_COUNTRY: 'High-risk country',
};

interface Props {
  summary: AsyncState<Summary>;
  config: ConfigInfo | null;
  activeRule: RuleId | undefined;
  onSelect: (rule: RuleId | undefined) => void;
  /** True while the account filter text is incomplete, so the counts shown are not for that filter. */
  stale?: boolean;
}

export function SummaryCards({ summary, config, activeRule, onSelect, stale = false }: Props) {
  const data = summary.data;
  const limits = config ? ruleLimits(config) : null;
  return (
    <section aria-label="Flag counts" className={`cards ${stale ? 'stale' : ''}`}>
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
          {limits && <span className="card-note">Limit: {limits[rule]}</span>}
        </button>
      ))}
      {summary.error && <p className="error" role="alert">{summary.error}</p>}
    </section>
  );
}

/** A compact line of the limits the rules are using right now. */
export function RulesStrip({ config }: { config: ConfigInfo }) {
  const limits = ruleLimits(config);
  return (
    <section className="rules-strip" aria-label="Rules in effect">
      <span className="rules-strip-title">Rules in effect</span>
      {RULE_IDS.map((rule) => (
        <span key={rule} className={`rule-chip rule-${rule}`}>
          <b>{RULE_LABELS[rule]}</b> {limits[rule]}
        </span>
      ))}
    </section>
  );
}
