/**
 * 储值流水的跨表游标过滤条件（纯函数，独立成文件避免查询服务继续膨胀）。
 *
 * 充值表与消费表的 kind 构成不同，必须分别构造：
 * 跨表共用同一数字阈值会把「同刻但不同 kind」的记录错误排除，导致翻页漏读。
 */
import type { Prisma } from '@prisma/client';
import type { ListLedgerEntriesOptions } from './club-records.types';
import {
  LEDGER_KIND_RANK,
  RECHARGE_TYPE_KIND_RANK,
  parseCompositeId,
} from './club-record-ledger-order.util';

/** 游标载荷（非空）：上一页最后一条的 createdAt + 复合 ID */
type LedgerCursor = NonNullable<ListLedgerEntriesOptions['cursor']>;

/** 充值单的 kind 取值（与 RECHARGE_TYPE_KIND_RANK 的键一致） */
type RechargeCursorType = 'recharge' | 'gift' | 'refund';

/** 同刻记录的单条条件 */
interface SameMomentCondition {
  createdAt: Date;
  type?: RechargeCursorType;
  id?: { lt: number };
}

/**
 * 构建充值表的游标过滤条件。
 *
 * 充值表一个表对应多种 kind（refund / recharge / gift→bonus），
 * 需按 type 分别判定它们在全序 (createdAt, kindRank, numericId) 中的位置：
 * - kind 权重小于游标：该 kind 整体排在游标之后（更旧）→ 同刻记录全取
 * - kind 权重等于游标：与本页最后一条同 kind → 取数字主键更小者
 * - kind 权重大于游标：该 kind 整体排在游标之前（更新）→ 已展示过，排除
 */
export function buildRechargeCursorWhere(
  cursor: LedgerCursor,
): Prisma.MarketingRechargeWhereInput {
  const { kindRank: cursorRank, numericId: cursorNumericId } = parseCompositeId(
    cursor.id,
  );

  const sameMoment: SameMomentCondition[] = [];

  for (const [type, rank] of RECHARGE_TYPE_KIND_RANK) {
    if (rank > cursorRank) {
      continue;
    }

    const condition: SameMomentCondition = {
      createdAt: cursor.createdAt,
      type,
    };
    if (rank === cursorRank) {
      condition.id = { lt: cursorNumericId };
    }

    sameMoment.push(condition);
  }

  return {
    OR: [{ createdAt: { lt: cursor.createdAt } }, ...sameMoment],
  };
}

/**
 * 构建消费表的游标过滤条件（该表只对应 consume 一种 kind，权重固定）。
 */
export function buildConsumptionCursorWhere(
  cursor: LedgerCursor,
): Prisma.MarketingConsumptionWhereInput {
  const { kindRank: cursorRank, numericId: cursorNumericId } = parseCompositeId(
    cursor.id,
  );
  const consumeRank = LEDGER_KIND_RANK.consume;

  // 消费 kind 整体排在游标之前（更新）→ 同刻记录已展示过，全部排除
  if (consumeRank > cursorRank) {
    return { OR: [{ createdAt: { lt: cursor.createdAt } }] };
  }

  const condition: SameMomentCondition = { createdAt: cursor.createdAt };
  if (consumeRank === cursorRank) {
    condition.id = { lt: cursorNumericId };
  }

  return { OR: [{ createdAt: { lt: cursor.createdAt } }, condition] };
}
