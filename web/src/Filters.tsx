import { RULE_IDS, type FlagSort, type RuleId } from './api';
import { RULE_LABELS } from './SummaryCards';

interface Props {
  rule: RuleId | undefined;
  accountText: string;
  accountValid: boolean;
  sort: FlagSort;
  onSortChange: (sort: FlagSort) => void;
  onRuleChange: (rule: RuleId | undefined) => void;
  onAccountTextChange: (text: string) => void;
  onClear: () => void;
}

export function Filters({ rule, accountText, accountValid, sort, onSortChange, onRuleChange, onAccountTextChange, onClear }: Props) {
  const filtered = rule !== undefined || accountText.trim() !== '';
  return (
    <form className="filters" onSubmit={(event) => event.preventDefault()} aria-label="Filters">
      <label>
        Rule
        <select value={rule ?? ''} onChange={(e) => onRuleChange((e.target.value || undefined) as RuleId | undefined)}>
          <option value="">All rules</option>
          {RULE_IDS.map((id) => (
            <option key={id} value={id}>
              {RULE_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Account
        <input
          type="search"
          placeholder="ACC-100118"
          value={accountText}
          aria-invalid={!accountValid}
          onChange={(e) => onAccountTextChange(e.target.value)}
        />
      </label>
      <label>
        Sort by
        <select value={sort} onChange={(e) => onSortChange(e.target.value as FlagSort)}>
          <option value="most_flags">Most flags first</option>
          <option value="newest">Newest first</option>
        </select>
      </label>
      {!accountValid && <span className="hint">Enter a full account id, like ACC-100118.</span>}
      {filtered && (
        <button type="button" className="link-button" onClick={onClear}>
          Clear filters
        </button>
      )}
    </form>
  );
}
