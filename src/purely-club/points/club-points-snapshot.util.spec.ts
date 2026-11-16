import type { ClubPointsBalanceWindow } from './club-points-snapshot.util';
import {
  buildPointsSnapshotsFromRecords,
  buildPointsSnapshotsFromWindow,
} from './club-points-snapshot.util';

interface PointsRow {
  id: number;
  amount: number;
  createdAt: Date;
}

/**
 * 模拟 DB 侧窗口函数输出（升序累计 + 合计），
 * 用于证明「新链路（DB 窗口聚合）→ 快照」与「旧链路（拉全量流水在内存正推）」逐条相等。
 */
const buildWindow = (rowsAsc: PointsRow[]): ClubPointsBalanceWindow => {
  let totalEffect = 0;
  const cumulativeEffectByRecordId = new Map<number, number>();

  for (const row of rowsAsc) {
    totalEffect += row.amount;
    cumulativeEffectByRecordId.set(row.id, totalEffect);
  }

  return { totalEffect, cumulativeEffectByRecordId };
};

const row = (id: number, amount: number, iso: string): PointsRow => ({
  id,
  amount,
  createdAt: new Date(iso),
});

describe('积分余额快照 · 新旧算法等价性', () => {
  it('普通流水：每条快照逐条相等', () => {
    const rows = [
      row(11, 100, '2024-11-20T10:00:00.000Z'),
      row(12, -30, '2024-11-20T12:00:00.000Z'),
      row(13, 50, '2024-11-21T10:00:00.000Z'),
    ];
    const currentPoints = 120;

    const oldSnapshots = buildPointsSnapshotsFromRecords(rows, currentPoints);
    const newSnapshots = buildPointsSnapshotsFromWindow(
      buildWindow(rows),
      currentPoints,
    );

    expect([...newSnapshots.entries()]).toEqual([...oldSnapshots.entries()]);
    expect([...newSnapshots.entries()]).toEqual([
      [11, 100],
      [12, 70],
      [13, 120],
    ]);
  });

  it('同刻多条：按主键升序定序，新旧算法一致（快照不互换）', () => {
    const sameTime = '2024-11-20T10:00:00.000Z';
    const rows = [
      row(21, -30, sameTime),
      row(22, 100, sameTime),
      row(23, 10, sameTime),
    ];
    const currentPoints = 120;

    const oldSnapshots = buildPointsSnapshotsFromRecords(rows, currentPoints);
    const newSnapshots = buildPointsSnapshotsFromWindow(
      buildWindow(rows),
      currentPoints,
    );

    expect([...newSnapshots.entries()]).toEqual([...oldSnapshots.entries()]);
    // 起点 = 120 - (100 - 30 + 10) = 40 → 21 后 10、22 后 110、23 后 120
    expect([...newSnapshots.entries()]).toEqual([
      [21, 10],
      [22, 110],
      [23, 120],
    ]);
  });

  it('跨 Tab 过滤：被筛掉的流水仍计入快照基准', () => {
    // 页内只展示 earn（11、13），窗口里夹着被过滤的消耗 12
    const rows = [
      row(11, 100, '2024-11-20T10:00:00.000Z'),
      row(12, -30, '2024-11-20T12:00:00.000Z'),
      row(13, 50, '2024-11-21T10:00:00.000Z'),
    ];
    const currentPoints = 120;

    const newSnapshots = buildPointsSnapshotsFromWindow(
      buildWindow(rows),
      currentPoints,
    );

    expect(newSnapshots.get(13)).toBe(120);
    expect(newSnapshots.get(11)).toBe(100);
    // 若只按页内记录正推，13 会被算成 150（漏掉 12 的 -30）
    expect(newSnapshots.get(13)).not.toBe(150);
  });

  it('空窗口：不产生任何快照', () => {
    expect(
      buildPointsSnapshotsFromWindow(
        { totalEffect: 0, cumulativeEffectByRecordId: new Map() },
        0,
      ),
    ).toEqual(new Map());
  });
});
