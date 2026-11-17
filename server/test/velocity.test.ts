import { describe, expect, it } from 'vitest';
import { velocity } from '../src/rules/velocity.js';
import { burst, txn } from './helpers.js';

const START = '2026-10-01T10:00:00+03:00';
const DEFAULT_LIMITS = { minCount: 5, windowMinutes: 60 };
const MIN = 60;

const flaggedIds = (flags: { transaction_id: string }[]) => flags.map((f) => f.transaction_id).sort();

describe('VELOCITY', () => {
  it('flags every transaction in a burst of 5 within 60 minutes, with the actual values', () => {
    const txns = burst('B', START, [0, 10 * MIN, 20 * MIN, 30 * MIN, 40 * MIN]);
    const flags = velocity(txns, DEFAULT_LIMITS);

    expect(flaggedIds(flags)).toEqual(['B-1', 'B-2', 'B-3', 'B-4', 'B-5']);
    expect(flags[0].reason).toBe('VELOCITY: 5 transactions in 40 min (limit: 5 in 60 min)');
    expect(flags[0].details).toMatchObject({
      count: 5,
      span_seconds: 2400,
      window_start: '2026-10-01T10:00:00+03:00',
      window_end: '2026-10-01T10:40:00+03:00',
      limit_count: 5,
      limit_window_minutes: 60,
    });
    expect(flags[0].details.related_transaction_ids).toEqual(['B-2', 'B-3', 'B-4', 'B-5']);
  });

  it('does not flag 4 transactions inside the window', () => {
    expect(velocity(burst('B', START, [0, 10 * MIN, 20 * MIN, 30 * MIN]), DEFAULT_LIMITS)).toEqual([]);
  });

  it('flags a span of exactly 60:00', () => {
    const flags = velocity(burst('B', START, [0, 15 * MIN, 30 * MIN, 45 * MIN, 60 * MIN]), DEFAULT_LIMITS);
    expect(flags).toHaveLength(5);
    expect(flags[0].reason).toBe('VELOCITY: 5 transactions in 60 min (limit: 5 in 60 min)');
  });

  it('does not flag a span of 60:01', () => {
    const txns = burst('B', START, [0, 15 * MIN, 30 * MIN, 45 * MIN, 60 * MIN + 1]);
    expect(velocity(txns, DEFAULT_LIMITS)).toEqual([]);
  });

  it('shows a span of 59:59 as 59 minutes, never rounding up past the limit', () => {
    const flags = velocity(burst('B', START, [0, 15 * MIN, 30 * MIN, 45 * MIN, 60 * MIN - 1]), DEFAULT_LIMITS);
    expect(flags[0].reason).toContain('in 59 min');
  });

  it('flags a rolling burst where no single window holds every transaction', () => {
    const txns = burst('B', START, [0, 15 * MIN, 30 * MIN, 45 * MIN, 60 * MIN, 75 * MIN]);
    const flags = velocity(txns, DEFAULT_LIMITS);
    expect(flaggedIds(flags)).toEqual(['B-1', 'B-2', 'B-3', 'B-4', 'B-5', 'B-6']);
    const last = flags.find((f) => f.transaction_id === 'B-6')!;
    expect(last.details.related_transaction_ids).toEqual(['B-2', 'B-3', 'B-4', 'B-5']);
  });

  it('flags only the transactions in the burst, not later ones outside every qualifying window', () => {
    const txns = burst('B', START, [0, 10 * MIN, 20 * MIN, 30 * MIN, 40 * MIN, 100 * MIN, 110 * MIN]);
    expect(flaggedIds(velocity(txns, DEFAULT_LIMITS))).toEqual(['B-1', 'B-2', 'B-3', 'B-4', 'B-5']);
  });

  it('describes the largest window that contains each transaction', () => {
    // Window from 0:00 holds 6 (0,1,2,3,4 and 60 min). B-7 at 61 min is only in windows that hold 6 as well.
    const txns = burst('B', START, [0, 1 * MIN, 2 * MIN, 3 * MIN, 4 * MIN, 60 * MIN, 61 * MIN]);
    const flags = velocity(txns, DEFAULT_LIMITS);
    expect(flaggedIds(flags)).toHaveLength(7);
    const lateOne = flags.find((f) => f.transaction_id === 'B-7')!;
    expect(lateOne.details.count).toBe(6);
    expect(lateOne.details.window_start).toBe('2026-10-01T10:01:00+03:00');
    expect(lateOne.reason).toBe('VELOCITY: 6 transactions in 60 min (limit: 5 in 60 min)');
  });

  it('counts transactions with the same timestamp separately', () => {
    const flags = velocity(burst('B', START, [0, 0, 0, 0, 0]), DEFAULT_LIMITS);
    expect(flags).toHaveLength(5);
    expect(flags[0].reason).toBe('VELOCITY: 5 transactions in 0 min (limit: 5 in 60 min)');
  });

  it('keeps accounts separate', () => {
    const txns = [
      ...burst('A', START, [0, 10 * MIN, 20 * MIN], 'ACC-100001'),
      ...burst('B', START, [5 * MIN, 15 * MIN, 25 * MIN], 'ACC-100002'),
    ];
    expect(velocity(txns, DEFAULT_LIMITS)).toEqual([]);
  });

  it('does not depend on the order of the input (late-arriving rows)', () => {
    const txns = burst('B', START, [0, 10 * MIN, 20 * MIN, 30 * MIN, 40 * MIN]);
    const inOrder = velocity(txns, DEFAULT_LIMITS);
    const reversed = velocity([...txns].reverse(), DEFAULT_LIMITS);
    expect(flaggedIds(reversed)).toEqual(flaggedIds(inOrder));
    expect(reversed.map((f) => f.reason).sort()).toEqual(inOrder.map((f) => f.reason).sort());
  });

  it('places a late row at its real time, completing a burst', () => {
    const early = [txn('A', '2026-10-22T16:30:22+03:00'), txn('B', '2026-10-22T16:36:41+03:00')];
    const later = [txn('D', '2026-10-22T16:49:44+03:00'), txn('E', '2026-10-22T16:54:36+03:00')];
    const lateArrival = txn('LATE', '2026-10-22T16:41:52+03:00');
    expect(velocity([...early, ...later], DEFAULT_LIMITS)).toEqual([]);
    expect(flaggedIds(velocity([...early, ...later, lateArrival], DEFAULT_LIMITS))).toEqual(['A', 'B', 'D', 'E', 'LATE']);
  });

  it('converts a Z timestamp to the same instant as +03:00 times before counting', () => {
    const txns = [
      txn('T1', '2026-10-25T10:00:00+03:00'),
      txn('T2', '2026-10-25T10:05:00+03:00'),
      txn('T3', '2026-10-25T10:10:00+03:00'),
      txn('UTC', '2026-10-25T07:15:00Z'), // 10:15 in Kuwait
      txn('T5', '2026-10-25T10:20:00+03:00'),
    ];
    const flags = velocity(txns, DEFAULT_LIMITS);
    expect(flaggedIds(flags)).toEqual(['T1', 'T2', 'T3', 'T5', 'UTC']);
    expect(flags[0].details.window_start).toBe('2026-10-25T10:00:00+03:00');
  });

  it('counts a burst that crosses midnight', () => {
    const txns = [
      txn('N1', '2026-10-20T23:40:05+03:00'),
      txn('N2', '2026-10-20T23:48:30+03:00'),
      txn('N3', '2026-10-20T23:55:12+03:00'),
      txn('N4', '2026-10-21T00:03:44+03:00'),
      txn('N5', '2026-10-21T00:11:09+03:00'),
    ];
    expect(velocity(txns, DEFAULT_LIMITS)).toHaveLength(5);
  });

  it('counts transactions with a missing amount or country towards a burst', () => {
    const txns = burst('B', START, [0, 10 * MIN, 20 * MIN, 30 * MIN, 40 * MIN]);
    txns[1].amount_kwd_fils = null;
    txns[2].counterparty_country = null;
    expect(velocity(txns, DEFAULT_LIMITS)).toHaveLength(5);
  });

  it('reads the limits from its argument', () => {
    const txns = burst('B', START, [0, 10 * MIN, 20 * MIN]);
    expect(velocity(txns, DEFAULT_LIMITS)).toEqual([]);
    const flags = velocity(txns, { minCount: 3, windowMinutes: 30 });
    expect(flags).toHaveLength(3);
    expect(flags[0].reason).toBe('VELOCITY: 3 transactions in 20 min (limit: 3 in 30 min)');
    expect(velocity(burst('B', START, [0, 10 * MIN, 31 * MIN]), { minCount: 3, windowMinutes: 30 })).toEqual([]);
  });
});
