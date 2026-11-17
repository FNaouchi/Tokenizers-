import { Fragment, useState } from 'react';
import { api, type Flag, type FlaggedTransaction } from './api';
import { dataQualityNote, describeTransaction, reasonValues } from './format';
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

type Row =
  | { kind: 'single'; txn: FlaggedTransaction }
  | { kind: 'burst'; key: string; members: FlaggedTransaction[]; ids: string[]; velocity: Flag };

const velocityOf = (txn: FlaggedTransaction) => txn.flags.find((flag) => flag.rule_id === 'VELOCITY');
const relatedIds = (flag: Flag) => (flag.details.related_transaction_ids as string[] | undefined) ?? [];

/**
 * Turns the page into rows, folding transactions of the same velocity burst into one row.
 * Bursts are found from the related ids the API gives for each flag; nothing is recomputed here.
 */
export function buildRows(items: FlaggedTransaction[]): Row[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  for (const txn of items) {
    const velocity = velocityOf(txn);
    if (!velocity) continue;
    for (const id of relatedIds(velocity)) parent.set(find(id), find(txn.transaction_id));
  }

  const rows: Row[] = [];
  const bursts = new Map<string, Extract<Row, { kind: 'burst' }>>();
  for (const txn of items) {
    const velocity = velocityOf(txn);
    if (!velocity) {
      rows.push({ kind: 'single', txn });
      continue;
    }
    const key = find(txn.transaction_id);
    const existing = bursts.get(key);
    if (existing) {
      existing.members.push(txn);
      for (const id of [txn.transaction_id, ...relatedIds(velocity)]) if (!existing.ids.includes(id)) existing.ids.push(id);
      if ((velocity.details.count as number) > (existing.velocity.details.count as number)) existing.velocity = velocity;
    } else {
      const row: Extract<Row, { kind: 'burst' }> = {
        kind: 'burst',
        key,
        members: [txn],
        ids: [txn.transaction_id, ...relatedIds(velocity)],
        velocity,
      };
      bursts.set(key, row);
      rows.push(row);
    }
  }
  return rows;
}

export function burstTitle(row: Extract<Row, { kind: 'burst' }>): string {
  const { count, span_seconds } = row.velocity.details as { count: number; span_seconds: number };
  return `${count} transactions in ${Math.floor(span_seconds / 60)} min on ${row.members[0].account.account_id}`;
}

export function FlagTable({ items, onAccountClick }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (items.length === 0) return <p className="empty">No flagged transactions match these filters.</p>;

  const rows = buildRows(items);

  return (
    <div className="table-wrap">
    <table className="flags">
      <thead>
        <tr>
          <th>Time (Kuwait)</th>
          <th>Transaction</th>
          <th>Why it was flagged</th>
          <th>Account</th>
          <th>Segment</th>
          <th>Branch</th>
          <th className="num">Amount (KWD)</th>
          <th>Country</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          if (row.kind === 'burst') {
            const isOpen = expanded === row.key;
            const first = row.members[0];
            const { window_start, window_end } = row.velocity.details as { window_start: string; window_end: string };
            const maxFlags = Math.max(...row.members.map((m) => m.flags.length));
            return (
              <Fragment key={row.key}>
                <tr className={isOpen ? 'open' : undefined}>
                  <td className="nowrap" data-label="Time (Kuwait)">
                    {formatTime(window_start)} – {window_end.slice(11, 19)}
                  </td>
                  <td className="txn">
                    <button
                      type="button"
                      className="link-button"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : row.key)}
                    >
                      {isOpen ? '▾' : '▸'} {burstTitle(row)}
                    </button>
                    {maxFlags > 1 && <span className="flag-count">includes {maxFlags}-flag transactions</span>}
                  </td>
                  <td data-label="Why it was flagged" className="why">
                    <ul className="reasons">
                      <li>
                        <span className="badge rule-VELOCITY">{RULE_LABELS.VELOCITY}</span> {reasonValues(row.velocity)}
                      </li>
                    </ul>
                  </td>
                  <td data-label="Account">
                    <button type="button" className="link-button" title="Filter by this account" onClick={() => onAccountClick(first.account.account_id)}>
                      {first.account.account_id}
                    </button>
                  </td>
                  <td data-label="Segment">
                    <span className={`segment segment-${first.account.customer_segment}`}>{first.account.customer_segment}</span>
                  </td>
                  <td data-label="Branch">{first.account.home_branch}</td>
                  <td colSpan={2} />
                </tr>
                {isOpen && (
                  <tr className="detail">
                    <td colSpan={8} className="detail-cell">
                      <BurstTransactions row={row} pageItems={items} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          }

          const txn = row.txn;
          return (
            <tr key={txn.transaction_id}>
              <td className="nowrap" data-label="Time (Kuwait)">{formatTime(txn.timestamp)}</td>
              <td className="txn">
                <span className="txn-id">{txn.transaction_id}</span>
                {txn.flags.length > 1 && <span className="flag-count">{txn.flags.length} flags</span>}
                <div className="meta">
                  {describeTransaction(txn.direction, txn.transaction_type, txn.channel)}
                </div>
              </td>
              <td data-label="Why it was flagged" className="why">
                <ul className="reasons">
                  {txn.flags.map((flag) => (
                    <li key={flag.rule_id}>
                      <span className={`badge rule-${flag.rule_id}`}>{RULE_LABELS[flag.rule_id]}</span> {reasonValues(flag)}
                    </li>
                  ))}
                </ul>
                {txn.data_quality.length > 0 && (
                  <div className="dq">
                    {txn.data_quality.map((note) => (
                      <span key={note} className="badge dq-badge" title={dataQualityNote(note).explanation}>
                        {dataQualityNote(note).label}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td data-label="Account">
                <button type="button" className="link-button" title="Filter by this account" onClick={() => onAccountClick(txn.account.account_id)}>
                  {txn.account.account_id}
                </button>
              </td>
              <td data-label="Segment">
                <span className={`segment segment-${txn.account.customer_segment}`}>{txn.account.customer_segment}</span>
              </td>
              <td data-label="Branch">{txn.account.home_branch}</td>
              <td className="num" data-label="Amount (KWD)">{txn.amount_kwd ?? '—'}</td>
              <td data-label="Country">{txn.counterparty_country ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function BurstTransactions({ row, pageItems }: { row: Extract<Row, { kind: 'burst' }>; pageItems: FlaggedTransaction[] }) {
  const known = new Map(pageItems.map((txn) => [txn.transaction_id, txn]));
  const missing = row.ids.filter((id) => !known.has(id));
  const fetched = useApi((signal) => Promise.all(missing.map((id) => api.transaction(id, signal))), [row.key]);

  if (fetched.loading) return <p className="meta">Loading the transactions in this burst…</p>;
  if (fetched.error) return <p className="error" role="alert">{fetched.error}</p>;

  const burst = [...row.ids.filter((id) => known.has(id)).map((id) => known.get(id)!), ...(fetched.data ?? [])].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  return (
    <table className="related">
      <thead>
        <tr>
          <th>Time (Kuwait)</th>
          <th>Transaction</th>
          <th className="num">Amount (KWD)</th>
          <th>Country</th>
          <th>Other flags and notes</th>
        </tr>
      </thead>
      <tbody>
        {burst.map((txn) => (
          <tr key={txn.transaction_id}>
            <td className="nowrap" data-label="Time (Kuwait)">{formatTime(txn.timestamp)}</td>
            <td data-label="Transaction">{txn.transaction_id}</td>
            <td className="num" data-label="Amount (KWD)">{txn.amount_kwd ?? '—'}</td>
            <td data-label="Country">{txn.counterparty_country ?? '—'}</td>
            <td data-label="Other flags and notes">
              {txn.flags
                .filter((flag) => flag.rule_id !== 'VELOCITY')
                .map((flag) => (
                  <span key={flag.rule_id} className={`badge rule-${flag.rule_id}`} title={flag.reason}>
                    {RULE_LABELS[flag.rule_id]}
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
  );
}
