import type {
  ClubLedgerBalanceWindow,
  ClubLedgerEntry,
} from './club-records.types';

/**
 * 流水 kind 权重：desc 排序时值大的在前。
 * 取值与复合 id 前缀的字典序一致（refund > recharge > consume > bonus），
 * 使「排序 tie-break」与「游标 tie-break 过滤」基于同一个全序键 (createdAt, kindRank, numericId)。
 *
 * 为什么必须统一：PostgreSQL 事务内 now() 恒定，同事务批量写入的流水 createdAt 完全相同，
 * 同刻记录真实存在。若排序按复合 id 字典序、过滤却按数字主键比较，两者规则不一致，
 * 会把排序在游标之后的同刻记录整段漏掉（分页永远取不到）。
 *
 * 同一份权重在 DB 侧以 CASE 表达式复刻（club-record-balance-window.query.ts），
 * 改动时必须同步两处，否则余额快照窗口的定序会与展示排序分叉。
 */
export const LEDGER_KIND_RANK: Record<string, number> = {
  refund: 4,
  recharge: 3,
  consume: 2,
  bonus: 1,
};

/** 充值表 type → kind 权重（gift 展示为 bonus，故取 bonus 的权重） */
export const RECHARGE_TYPE_KIND_RANK: ReadonlyArray<
  readonly ['recharge' | 'gift' | 'refund', number]
> = [
  ['refund', LEDGER_KIND_RANK.refund],
  ['recharge', LEDGER_KIND_RANK.recharge],
  ['gift', LEDGER_KIND_RANK.bonus],
];

/** 解析复合 id（如 "recharge-18"）为 kind 权重与数字主键 */
export const parseCompositeId = (
  compositeId: string,
): { kindRank: number; numericId: number } => {
  const separatorIndex = compositeId.lastIndexOf('-');
  const prefix = compositeId.slice(0, separatorIndex);
  const numericId = Number.parseInt(compositeId.slice(separatorIndex + 1), 10);

  return {
    kindRank: LEDGER_KIND_RANK[prefix] ?? 0,
    numericId: Number.isNaN(numericId) ? 0 : numericId,
  };
};

/** 流水条目倒序比较：createdAt desc → kindRank desc → numericId desc（全序，与游标过滤同源） */
export const compareLedgerEntriesDesc = (
  left: ClubLedgerEntry,
  right: ClubLedgerEntry,
): number => {
  const timeDiff = right.createdAt.getTime() - left.createdAt.getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }

  const leftKey = parseCompositeId(left.id);
  const rightKey = parseCompositeId(right.id);
  const rankDiff = rightKey.kindRank - leftKey.kindRank;
  if (rankDiff !== 0) {
    return rankDiff;
  }

  return rightKey.numericId - leftKey.numericId;
};

/** 流水条目升序比较（余额快照正推用）：与倒序严格互逆，保证同刻条目先后关系一致 */
export const compareLedgerEntriesAsc = (
  left: ClubLedgerEntry,
  right: ClubLedgerEntry,
): number => -compareLedgerEntriesDesc(left, right);

/**
 * 余额快照 · 全量反推（历史算法，保留为等价性基准与降级路径）。
 *
 * 算法：起始余额 = 当前余额 − 本批流水影响之和，再从最旧一条逐条正推。
 * 只有整批流水都拿到时结果才正确；缺任何一条（分页只取一页、或按 Tab 过滤）
 * 都会让反推起点偏移。因此正式链路已改为 DB 侧窗口聚合
 * （buildLedgerBalanceSnapshotsFromWindow），本函数只用于：
 * 1. 单元测试中作为「改前算法」的对照基准；
 * 2. 调用方未提供窗口聚合结果时的降级（保持旧行为，不静默改变数值）。
 */
export function buildLedgerBalanceSnapshotsFromEntries(params: {
  entries: ClubLedgerEntry[];
  currentBalanceFen: number;
}): Record<string, number> {
  const { entries, currentBalanceFen } = params;
  const ascending = [...entries].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const totalEffectFen = ascending.reduce(
    (sum, entry) => sum + entry.balanceEffectFen,
    0,
  );

  let runningBalanceFen = currentBalanceFen - totalEffectFen;
  const snapshots: Record<string, number> = {};
  for (const entry of ascending) {
    runningBalanceFen += entry.balanceEffectFen;
    snapshots[entry.id] = runningBalanceFen;
  }

  return snapshots;
}

/**
 * 余额快照 · 窗口聚合（当前链路）。
 *
 * 等价性：DB 侧用 `SUM(effect) OVER (ORDER BY createdAt, kindRank, numericId)` 求出
 * 「窗口内截至本条（含）的影响累计」，窗口起点与旧算法完全一致（本页最旧一条的 createdAt），
 * 故 `当前余额 − 窗口合计 + 本条累计` 恒等于旧算法的
 * `(当前余额 − 窗口合计) + 窗口内前缀和`，逐条相等。
 *
 * 幂等性：即使窗口内某条流水在两次查询之间被追加，只要快照窗口与当前余额取自同一时刻的
 * 语义（与改前一致），偏移方式也完全相同，不引入新的漂移来源。
 */
export function buildLedgerBalanceSnapshotsFromWindow(
  window: ClubLedgerBalanceWindow,
  currentBalanceFen: number,
): Record<string, number> {
  const snapshots: Record<string, number> = {};
  const baseBalanceFen = currentBalanceFen - window.totalEffectFen;

  for (const [entryId, cumulativeEffectFen] of Object.entries(
    window.cumulativeEffectFenById,
  )) {
    snapshots[entryId] = baseBalanceFen + cumulativeEffectFen;
  }

  return snapshots;
}
