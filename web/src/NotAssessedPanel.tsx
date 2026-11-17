import { api } from './api';
import { dataQualityNote } from './format';
import { formatTime } from './FlagTable';
import { RULE_LABELS } from './SummaryCards';
import { useApi } from './useApi';

interface Props {
  account: string | undefined;
  onAccountClick: (accountId: string) => void;
}

/** Transactions that a rule could not check because a value was missing, so an analyst can review them by hand. */
export function NotAssessedPanel({ account, onAccountClick }: Props) {
  const result = useApi((signal) => api.notAssessed({ account_id: account, limit: 100 }, signal), [account]);
  const page = result.data;

  return (
    <details className="import-panel">
      <summary>Not fully checked{page ? `: ${page.total} transaction${page.total === 1 ? '' : 's'}` : ''}</summary>
      <p className="meta">
        A rule can't judge a transaction when its amount or country is missing. Check these by hand.
      </p>
      {result.error && <p className="error" role="alert">{result.error}</p>}
      {page && page.items.length === 0 && <p className="meta">Nothing to review.</p>}
      {page && page.items.length > 0 && (
        <div className="table-wrap">
          <table className="related">
            <thead>
              <tr>
                <th>Time (Kuwait)</th>
                <th>Transaction</th>
                <th>Account</th>
                <th>Segment</th>
                <th className="num">Amount (KWD)</th>
                <th>Country</th>
                <th>Not checked</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((txn) => (
                <tr key={txn.transaction_id}>
                  <td className="nowrap">{formatTime(txn.timestamp)}</td>
                  <td>{txn.transaction_id}</td>
                  <td>
                    <button type="button" className="link-button" onClick={() => onAccountClick(txn.account.account_id)}>
                      {txn.account.account_id}
                    </button>
                  </td>
                  <td>{txn.account.customer_segment}</td>
                  <td className="num">{txn.amount_kwd ?? '—'}</td>
                  <td>{txn.counterparty_country ?? '—'}</td>
                  <td>
                    {txn.not_assessed.map((rule) => (
                      <span key={rule} className={`badge rule-${rule}`}>
                        {RULE_LABELS[rule]}
                      </span>
                    ))}
                    {txn.data_quality.map((note) => (
                      <span key={note} className="badge dq-badge" title={dataQualityNote(note).explanation}>
                        {dataQualityNote(note).label}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
