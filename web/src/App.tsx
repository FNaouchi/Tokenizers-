import { useState } from 'react';
import { api, type FlagSort, type RuleId } from './api';
import { HighRiskCountriesContext } from './Country';
import { Filters } from './Filters';
import { FlagTable } from './FlagTable';
import { ImportPanel } from './ImportPanel';
import { NotAssessedPanel } from './NotAssessedPanel';
import { SummaryCards } from './SummaryCards';
import { useApi } from './useApi';

const PAGE_SIZE = 50;
const ACCOUNT_PATTERN = /^ACC-\d+$/;

export function App() {
  const [rule, setRule] = useState<RuleId | undefined>();
  const [accountText, setAccountText] = useState('');
  const [sort, setSort] = useState<FlagSort>('most_flags');
  const [offset, setOffset] = useState(0);

  const trimmed = accountText.trim().toUpperCase();
  const accountValid = trimmed === '' || ACCOUNT_PATTERN.test(trimmed);
  const account = trimmed !== '' && accountValid ? trimmed : undefined;

  const config = useApi((signal) => api.config(signal), []);
  const summary = useApi((signal) => api.summary({ account_id: account }, signal), [account]);
  const flags = useApi(
    (signal) => api.flags({ rule, sort, account_id: account, limit: PAGE_SIZE, offset }, signal),
    [rule, sort, account, offset],
  );

  const changeRule = (next: RuleId | undefined) => {
    setRule(next);
    setOffset(0);
  };
  const changeSort = (next: FlagSort) => {
    setSort(next);
    setOffset(0);
  };
  const changeAccount = (text: string) => {
    setAccountText(text);
    setOffset(0);
  };

  const page = flags.data;
  const first = page && page.total > 0 ? page.offset + 1 : 0;
  const last = page ? page.offset + page.items.length : 0;

  return (
    <HighRiskCountriesContext.Provider value={config.data?.high_risk_countries ?? []}>
    <div className="app">
      <header>
        <h1>AML Transaction Flagger</h1>
        <p className="subtitle">October 2026 · synthetic data · times in Kuwait time (UTC+03:00)</p>
        {config.data && (
          <p className="limits" aria-label="Active rule limits">
            Limits: large amount ≥ {config.data.large_amount_kwd} KWD · velocity ≥ {config.data.velocity.min_count} transactions
            within {config.data.velocity.window_minutes} min · high-risk countries:{' '}
            {config.data.high_risk_countries.map((c) => c.country_code).join(', ')}
          </p>
        )}
        {config.error && <p className="error" role="alert">{config.error}</p>}
      </header>

      <SummaryCards summary={summary} activeRule={rule} onSelect={changeRule} stale={!accountValid} />

      <Filters
        rule={rule}
        accountText={accountText}
        accountValid={accountValid}
        sort={sort}
        onSortChange={changeSort}
        onRuleChange={changeRule}
        onAccountTextChange={changeAccount}
        onClear={() => {
          setRule(undefined);
          setAccountText('');
          setOffset(0);
        }}
      />

      <main aria-busy={flags.loading}>
        {!accountValid && (
          <p className="empty">Finish typing a full account id, like ACC-100118. The account filter is not applied yet.</p>
        )}
        {accountValid && flags.error && <p className="error" role="alert">{flags.error}</p>}
        {accountValid && page && (
          <>
            <p className="result-count">
              {page.total === 0 ? 'No results' : `Showing ${first}–${last} of ${page.total} flagged transactions`}
            </p>
            <FlagTable items={page.items} onAccountClick={changeAccount} />
            <nav className="pager" aria-label="Pages">
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Previous
              </button>
              <button type="button" disabled={last >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Next
              </button>
            </nav>
          </>
        )}
        {accountValid && !page && flags.loading && <p className="empty">Loading…</p>}
      </main>

      <NotAssessedPanel account={account} onAccountClick={changeAccount} />
      <ImportPanel />
    </div>
    </HighRiskCountriesContext.Provider>
  );
}
