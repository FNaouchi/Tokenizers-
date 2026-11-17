import { RULE_IDS, type ConfigInfo, type FlagSort, type RuleId } from './api';
import { RULE_LABELS } from './SummaryCards';

/** What the analyst has typed into the filter boxes. Empty text means "no filter". */
export interface FilterValues {
  rule: RuleId | undefined;
  accountText: string;
  dateFrom: string;
  dateTo: string;
  segment: string;
  branch: string;
  minAmountText: string;
}

export const NO_FILTERS: FilterValues = {
  rule: undefined,
  accountText: '',
  dateFrom: '',
  dateTo: '',
  segment: '',
  branch: '',
  minAmountText: '',
};

const ACCOUNT_PATTERN = /^ACC-\d+$/;
const AMOUNT_PATTERN = /^\d+(\.\d{1,3})?$/;

export interface FilterProblems {
  account: boolean;
  dates: boolean;
  minAmount: boolean;
}

export function checkFilters(values: FilterValues): FilterProblems {
  const account = values.accountText.trim().toUpperCase();
  return {
    account: account !== '' && !ACCOUNT_PATTERN.test(account),
    dates: values.dateFrom !== '' && values.dateTo !== '' && values.dateFrom > values.dateTo,
    minAmount: values.minAmountText.trim() !== '' && !AMOUNT_PATTERN.test(values.minAmountText.trim()),
  };
}

interface Props {
  values: FilterValues;
  problems: FilterProblems;
  config: ConfigInfo | null;
  sort: FlagSort;
  onSortChange: (sort: FlagSort) => void;
  onChange: (patch: Partial<FilterValues>) => void;
  onClear: () => void;
}

export function Filters({ values, problems, config, sort, onSortChange, onChange, onClear }: Props) {
  const filtered = Object.entries(values).some(([, value]) => value !== undefined && String(value).trim() !== '');
  return (
    <form className="filters" onSubmit={(event) => event.preventDefault()} aria-label="Filters">
      <label>
        Rule
        <select value={values.rule ?? ''} onChange={(e) => onChange({ rule: (e.target.value || undefined) as RuleId | undefined })}>
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
          value={values.accountText}
          aria-invalid={problems.account}
          onChange={(e) => onChange({ accountText: e.target.value })}
        />
      </label>
      <label>
        From date
        <input type="date" value={values.dateFrom} aria-invalid={problems.dates} onChange={(e) => onChange({ dateFrom: e.target.value })} />
      </label>
      <label>
        To date
        <input type="date" value={values.dateTo} aria-invalid={problems.dates} onChange={(e) => onChange({ dateTo: e.target.value })} />
      </label>
      <label>
        Customer segment
        <select value={values.segment} onChange={(e) => onChange({ segment: e.target.value })}>
          <option value="">All segments</option>
          {(config?.customer_segments ?? []).map((segment) => (
            <option key={segment} value={segment}>
              {segment}
            </option>
          ))}
        </select>
      </label>
      <label>
        Branch
        <select value={values.branch} onChange={(e) => onChange({ branch: e.target.value })}>
          <option value="">All branches</option>
          {(config?.branches ?? []).map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>
      </label>
      <label>
        Minimum amount (KWD)
        <input
          type="text"
          inputMode="decimal"
          placeholder="3000"
          value={values.minAmountText}
          aria-invalid={problems.minAmount}
          onChange={(e) => onChange({ minAmountText: e.target.value })}
        />
      </label>
      <label>
        Sort by
        <select value={sort} onChange={(e) => onSortChange(e.target.value as FlagSort)}>
          <option value="most_flags">Most flags first</option>
          <option value="newest">Newest first</option>
        </select>
      </label>
      {filtered && (
        <button type="button" className="link-button" onClick={onClear}>
          Clear filters
        </button>
      )}
      <div className="hints" role="status">
        {problems.account && <span className="hint">Enter a full account id, like ACC-100118.</span>}
        {problems.dates && <span className="hint">The from date is after the to date.</span>}
        {problems.minAmount && <span className="hint">Enter an amount like 3000 or 3000.500.</span>}
      </div>
    </form>
  );
}
