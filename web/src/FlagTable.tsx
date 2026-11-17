import { Fragment, useState } from 'react';
import { api, type FlaggedTransaction } from './api';
import { RULE_LABELS } from './SummaryCards';
import { useApi } from './useApi';

/** Kuwait time as written by the API, shown without the offset: "2026-10-31 19:17:44". */
export function formatTime(timestamp: string): string {
  return timestamp.slice(0, 19).replace('T', ' ');
}

interface Props {
  items: FlaggedTransaction[];
  onAccountClick: (accountId: string) => void;
}

export function FlagTable({ items, onAccountClick }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (items.length === 0) return <p className="empty">No flagged transactions match these filters.</p>;

  return (
    <div className="table-wrap">
    <table className="flags">
      <thead>
        <tr>
          <th>Time (Kuwait)</th>
          <th>Transaction</th>
          <th>Account</th>
          <th>Segment</th>
          <th>Branch</th>
          <th className="num">Amount (KWD)</th>
          <th>Country</th>
          <th>Why it was flagged</th>
        </tr>
      </thead>
      <tbody>
        {items.map((txn) => {
          const isOpen = expanded === txn.transaction_id;
          return (
            <Fragment key={txn.transaction_id}>
              <tr className={isOpen ? 'open' : undefined}>
                <td className="nowrap">{formatTime(txn.timestamp)}</td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : txn.transaction_id)}
                  >
                    {isOpen ? '▾' : '▸'} {txn.transaction_id}
                  </button>
                  <div className="meta">
                    {txn.direction} · {txn.transaction_type} · {txn.channel}
                  </div>
                </td>
                <td>
                  <button type="button" className="link-button" title="Filter by this account" onClick={() => onAccountClick(txn.account.account_id)}>
                    {txn.account.account_id}
                  </button>
                </td>
                <td>
                  <span className={`segment segment-${txn.account.customer_segment}`}>{txn.account.customer_segment}</span>
                </td>
                <td>{txn.account.home_branch}</td>
                <td className="num">{txn.amount_kwd ?? '—'}</td>
                <td>{txn.counterparty_country ?? '—'}</td>
                <td>
                  <ul className="reasons">
                    {txn.flags.map((flag) => (
                      <li key={flag.rule_id}>
                        <span className={`badge rule-${flag.rule_id}`}>{RULE_LABELS[flag.rule_id]}</span> {flag.reason}
                      </li>
                    ))}
                  </ul>
                  {txn.data_quality.length > 0 && (
                    <div className="dq">
                      {txn.data_quality.map((note) => (
                        <span key={note} className="badge dq-badge" title="Data-quality note from the import">
                          {note}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
              {isOpen && (
                <tr className="detail">
                  <td colSpan={8}>
                    <RelatedTransactions transaction={txn} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function RelatedTransactions({ transaction }: { transaction: FlaggedTransaction }) {
  const velocity = transaction.flags.find((flag) => flag.rule_id === 'VELOCITY');
  const relatedIds = (velocity?.details.related_transaction_ids as string[] | undefined) ?? [];
  const related = useApi(
    (signal) => Promise.all(relatedIds.map((id) => api.transaction(id, signal))),
    [transaction.transaction_id],
  );

  if (!velocity) {
    return <p className="meta">Only burst (velocity) flags have related transactions.</p>;
  }
  if (related.loading) return <p className="meta">Loading the other transactions in this burst…</p>;
  if (related.error) return <p className="error" role="alert">{related.error}</p>;

  const burst = [transaction, ...(related.data ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return (
    <div>
      <p className="meta">
        Burst on {transaction.account.account_id}: {String(velocity.details.window_start).slice(0, 19).replace('T', ' ')} to{' '}
        {String(velocity.details.window_end).slice(11, 19)}
      </p>
      <table className="related">
        <thead>
          <tr>
            <th>Time (Kuwait)</th>
            <th>Transaction</th>
            <th className="num">Amount (KWD)</th>
            <th>Country</th>
          </tr>
        </thead>
        <tbody>
          {burst.map((txn) => (
            <tr key={txn.transaction_id} className={txn.transaction_id === transaction.transaction_id ? 'self' : undefined}>
              <td className="nowrap">{formatTime(txn.timestamp)}</td>
              <td>{txn.transaction_id}</td>
              <td className="num">{txn.amount_kwd ?? '—'}</td>
              <td>{txn.counterparty_country ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
