import type {
  ClubLedgerBalanceWindow,
  ClubLedgerEntry,
} from './club-records.types';
import {
  buildLedgerBalanceSnapshotsFromEntries,
  buildLedgerBalanceSnapshotsFromWindow,
  compareLedgerEntriesAsc,
} from './club-record-ledger-order.util';

const KIND_BY_PREFIX: Record<string, ClubLedgerEntry['type']> = {
  recharge: 'recharge',
  bonus: 'bonus',
  consume: 'consume',
  refund: 'refund',
};

const makeEntry = (
  id: string,
  balanceEffectFen: number,
  createdAtIso: string,
): ClubLedgerEntry => ({
  id,
  type: KIND_BY_PREFIX[id.slice(0, id.lastIndexOf('-'))] ?? 'recharge',
  amountFen: balanceEffectFen,
  balanceEffectFen,
  description: id,
  createdAt: new Date(createdAtIso),
});

/**
 * 模拟 DB 侧窗口函数输出（升序累计 + 合计），
 * 用于证明「新链路（DB 窗口聚合）→ 快照」与「旧链路（拉全量流水在内存正推）」逐条相等。
 */
const buildWindowFromEntries = (
  entries: ClubLedgerEntry[],
): ClubLedgerBalanceWindow => {
  let cumulativeEffectFen = 0;
  const cumulativeEffectFenById: Record<string, number> = {};

  for (const entry of entries) {
    cumulativeEffectFen += entry.balanceEffectFen;
    cumulativeEffectFenById[entry.id] = cumulativeEffectFen;
  }

  return { totalEffectFen: cumulativeEffectFen, cumulativeEffectFenById };
};

/** 旧链路：窗口内全量流水（生产上由查询层按 createdAt+kind+id 升序返回）在内存正推 */
const snapshotsByOldAlgorithm = (
  windowEntriesAsc: ClubLedgerEntry[],
  currentBalanceFen: number,
): Record<string, number> =>
  buildLedgerBalanceSnapshotsFromEntries({
    entries: [...windowEntriesAsc].sort(compareLedgerEntriesAsc),
    currentBalanceFen,
  });

describe('储值流水余额快照 · 新旧算法等价性', () => {
  it('普通账本：每条快照逐条相等', () => {
    const windowEntries = [
      makeEntry('recharge-1', 300000, '2024-09-01T00:00:00.000Z'),
      makeEntry('consume-1', -30000, '2024-10-05T00:00:00.000Z'),
      makeEntry('recharge-2', 500000, '2024-11-01T00:00:00.000Z'),
      makeEntry('consume-2', -50000, '2024-11-18T00:00:00.000Z'),
    ];
    const currentBalanceFen = 720000;

    const oldSnapshots = snapshotsByOldAlgorithm(
      windowEntries,
      currentBalanceFen,
    );
    const newSnapshots = buildLedgerBalanceSnapshotsFromWindow(
      buildWindowFromEntries(windowEntries),
      currentBalanceFen,
    );

    expect(newSnapshots).toEqual(oldSnapshots);
    expect(newSnapshots).toEqual({
      'recharge-1': 300000,
      'consume-1': 270000,
      'recharge-2': 770000,
      'consume-2': 720000,
    });
  });

  it('同刻多条：按 kindRank → 主键 定序，新旧算法一致', () => {
    const sameTime = '2024-11-20T10:00:00.000Z';
    // 同一事务写入：createdAt 相同，只能靠 kind 权重与主键定序
    const windowEntries = [
      makeEntry('bonus-7', 5000, sameTime),
      makeEntry('consume-9', -2000, sameTime),
      makeEntry('recharge-3', 10000, sameTime),
      makeEntry('refund-1', -3000, sameTime),
    ].sort(compareLedgerEntriesAsc);
    const currentBalanceFen = 10000;

    const oldSnapshots = snapshotsByOldAlgorithm(
      windowEntries,
      currentBalanceFen,
    );
    const newSnapshots = buildLedgerBalanceSnapshotsFromWindow(
      buildWindowFromEntries(windowEntries),
      currentBalanceFen,
    );

    expect(newSnapshots).toEqual(oldSnapshots);
    // 升序：bonus-7(权重1) → consume-9(2) → recharge-3(3) → refund-1(4)
    expect(Object.keys(newSnapshots)).toEqual([
      'bonus-7',
      'consume-9',
      'recharge-3',
      'refund-1',
    ]);
  });

  it('含退款：退款按本金 + 赠送整笔扣回，新旧算法一致', () => {
    const windowEntries = [
      makeEntry('recharge-5', 58000, '2024-11-01T00:00:00.000Z'),
      makeEntry('bonus-5', 8000, '2024-11-01T00:00:00.000Z'),
      makeEntry('refund-5', -58000, '2024-11-10T00:00:00.000Z'),
    ].sort(compareLedgerEntriesAsc);
    const currentBalanceFen = 8000;

    const oldSnapshots = snapshotsByOldAlgorithm(
      windowEntries,
      currentBalanceFen,
    );
    const newSnapshots = buildLedgerBalanceSnapshotsFromWindow(
      buildWindowFromEntries(windowEntries),
      currentBalanceFen,
    );

    expect(newSnapshots).toEqual(oldSnapshots);
    expect(newSnapshots['refund-5']).toBe(8000);
  });

  it('跨 Tab 过滤：本页只展示消费，窗口仍含被过滤掉的充值，结果与被展示条目无关', () => {
    const windowEntries = [
      makeEntry('consume-1', -30000, '2024-10-05T00:00:00.000Z'),
      makeEntry('recharge-2', 500000, '2024-11-01T00:00:00.000Z'),
      makeEntry('consume-2', -50000, '2024-11-18T00:00:00.000Z'),
    ];
    const currentBalanceFen = 720000;
    const pageEntries = [windowEntries[0], windowEntries[2]];

    const newSnapshots = buildLedgerBalanceSnapshotsFromWindow(
      buildWindowFromEntries(windowEntries),
      currentBalanceFen,
    );
    const oldSnapshots = snapshotsByOldAlgorithm(
      windowEntries,
      currentBalanceFen,
    );

    // 页内两条快照必须包含中间被过滤的充值影响（2700 / 7200 元）
    expect(pageEntries.map((entry) => newSnapshots[entry.id])).toEqual([
      270000, 720000,
    ]);
    expect(newSnapshots).toEqual(oldSnapshots);
  });
});
