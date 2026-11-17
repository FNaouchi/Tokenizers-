import { useState } from 'react';
import { api, type FlagSort, type RuleId, type TransactionFilters } from './api';
import { HighRiskCountriesContext } from './Country';
import { checkFilters, Filters, NO_FILTERS, type FilterValues } from './Filters';
import { FlagTable } from './FlagTable';
import { ImportPanel } from './ImportPanel';
import { NotAssessedPanel } from './NotAssessedPanel';
import { Pager } from './Pager';
import { RulesStrip, SummaryCards } from './SummaryCards';
import { useApi } from './useApi';

const PAGE_SIZE = 50;

export function App() {
  const [filters, setFilters] = useState<FilterValues>(NO_FILTERS);
  const [sort, setSort] = useState<FlagSort>('most_flags');
  const [offset, setOffset] = useState(0);

  const problems = checkFilters(filters);
  const filtersValid = !problems.account && !problems.dates && !problems.minAmount;
  const account = filters.accountText.trim().toUpperCase();
  const { rule } = filters;

  // Only valid values are sent, so a half-typed filter never reaches the API.
  const applied: TransactionFilters = {
    account_id: account !== '' && !problems.account ? account : undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    segment: filters.segment || undefined,
    branch: filters.branch || undefined,
    min_amount_kwd: filters.minAmountText.trim() !== '' && !problems.minAmount ? filters.minAmountText.trim() : undefined,
  };
  const appliedKey = JSON.stringify(applied);

  const config = useApi((signal) => api.config(signal), []);
  const summary = useApi((signal) => api.summary(applied, signal), [appliedKey]);
  const flags = useApi(
    (signal) => api.flags({ ...applied, rule, sort, limit: PAGE_SIZE, offset }, signal),
    [appliedKey, rule, sort, offset],
  );

  const changeFilters = (patch: Partial<FilterValues>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
    setOffset(0);
  };
  const changeRule = (next: RuleId | undefined) => changeFilters({ rule: next });
  const changeSort = (next: FlagSort) => {
    setSort(next);
    setOffset(0);
  };
  const changeAccount = (text: string) => changeFilters({ accountText: text });
  const nonRuleAccount = applied.account_id;

  const page = flags.data;
  const first = page && page.total > 0 ? page.offset + 1 : 0;
  const last = page ? page.offset + page.items.length : 0;

  return (
    <HighRiskCountriesContext.Provider value={config.data?.high_risk_countries ?? []}>
      <div className="app">
        <header>
          <h1>AML Transaction Flagger</h1>
          <p className="subtitle">October 2026 · synthetic data · times in Kuwait time (UTC+03:00)</p>
          {config.data && <RulesStrip config={config.data} />}
          {config.error && <p className="error" role="alert">{config.error}</p>}
        </header>

        <SummaryCards summary={summary} config={config.data} activeRule={rule} onSelect={changeRule} stale={!filtersValid} />

        <Filters
          values={filters}
          problems={problems}
          config={config.data}
          sort={sort}
          onSortChange={changeSort}
          onChange={changeFilters}
          onClear={() => {
            setFilters(NO_FILTERS);
            setOffset(0);
          }}
        />

        <main aria-busy={flags.loading}>
          {!filtersValid && <p className="empty">Fix the highlighted filter. Until then it is not applied.</p>}
          {filtersValid && flags.error && <p className="error" role="alert">{flags.error}</p>}
          {filtersValid && page && (
            <>
              <p className="result-count">
                {page.total === 0 ? 'No results' : `Showing ${first}–${last} of ${page.total} flagged transactions`}
              </p>
              <Pager label="Pages above the table" page={page} offset={offset} onOffsetChange={setOffset} />
              <FlagTable items={page.items} onAccountClick={changeAccount} />
              <Pager label="Pages below the table" page={page} offset={offset} onOffsetChange={setOffset} />
            </>
          )}
          {filtersValid && !page && flags.loading && <p className="empty">Loading…</p>}
        </main>

        <NotAssessedPanel account={nonRuleAccount} onAccountClick={changeAccount} />
        <ImportPanel />
      </div>
    </HighRiskCountriesContext.Provider>
  );
}
