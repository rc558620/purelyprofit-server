/**
 * 积分余额快照的纯计算内核（与 DB 侧窗口聚合配合使用）。
 *
 * 为什么拆出来：快照口径（起点反推 + 逐条累计）属于金额类规则，必须在 Node 侧
 * 有唯一事实来源并可直接单测；DB 只负责把「窗口合计」与「逐条累计」求出来。
 */

/** 积分快照窗口：不早于本页最旧一条的全量积分流水聚合值 */
export interface ClubPointsBalanceWindow {
  /** 窗口内全部积分流水的变动合计 */
  totalEffect: number;
  /** 窗口内每条记录（含自身）的变动累计，键为积分记录 ID */
  cumulativeEffectByRecordId: Map<number, number>;
}

/** 快照计算所需的最小记录形状 */
export interface ClubPointsSnapshotRecord {
  id: number;
  amount: number;
  createdAt: Date;
}

/**
 * 积分快照 · 全量反推（历史算法，保留为等价性基准与降级路径）。
 *
 * 算法：起始积分 = 当前积分 − 本批流水变动之和，再从最旧一条逐条正推。
 * 升序必须与展示排序（createdAt desc, id desc）严格互逆：同一事务写入的记录
 * createdAt 相同（Postgres now() 取事务开始时间），此时只能靠 ID 定序。
 *
 * 正式链路已改为 DB 侧窗口聚合（buildPointsSnapshotsFromWindow），本函数只用于：
 * 1. 单元测试中作为「改前算法」的对照基准；
 * 2. 调用方未提供窗口聚合结果时的降级（保持旧行为，不静默改变数值）。
 */
export function buildPointsSnapshotsFromRecords(
  records: ClubPointsSnapshotRecord[],
  currentPoints: number,
): Map<number, number> {
  const ascending = [...records].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
  );
  const totalEffect = ascending.reduce((sum, record) => sum + record.amount, 0);

  let runningPoints = currentPoints - totalEffect;
  const snapshots = new Map<number, number>();
  for (const record of ascending) {
    runningPoints += record.amount;
    snapshots.set(record.id, runningPoints);
  }

  return snapshots;
}

/**
 * 积分快照 · 窗口聚合（当前链路）。
 *
 * 等价性：DB 侧用 `SUM(amount) OVER (ORDER BY createdAt, id ROWS UNBOUNDED PRECEDING)`
 * 求出「窗口内截至本条（含）的变动累计」，窗口起点与旧算法一致（本页最旧一条的 createdAt），
 * 故 `当前积分 − 窗口合计 + 本条累计` 恒等于旧算法的 `(当前积分 − 窗口合计) + 前缀和`，
 * 逐条相等。
 */
export function buildPointsSnapshotsFromWindow(
  window: ClubPointsBalanceWindow,
  currentPoints: number,
): Map<number, number> {
  const basePoints = currentPoints - window.totalEffect;
  const snapshots = new Map<number, number>();

  for (const [
    recordId,
    cumulativeEffect,
  ] of window.cumulativeEffectByRecordId) {
    snapshots.set(recordId, basePoints + cumulativeEffect);
  }

  return snapshots;
}
