/**
 * 顾客消费指标（余额 / 累计消费 / 到店次数 / 会员等级）的原子写内核。
 *
 * 为什么必须统一：三处写入（储值扣款落账、团购券退款回冲、扫码点餐落账）
 * 原本各自「先读旧值 → JS 算新值 → 绝对赋值 / 按旧值算等级」。并发下会
 * 丢失更新、把等级算错，属于规范第十四章明确禁止的裸 read-modify-write。
 *
 * 统一后的职责边界：
 * - 累计消费、到店次数、余额一律在 SQL 侧做 `col + delta`（累计消费 / 次数用
 *   `GREATEST(..., 0)` 兜住历史脏数据），不再是「读出来再写回去」；
 * - 会员等级必须基于「数据库本次更新后的真实 total_spent」重算，不使用调用方
 *   读到的旧值；
 * - 等级区间规则仍只有 `calcCustomerTier` 一处事实来源，不搬到 SQL 里拼 CASE，
 *   避免 JS 与 SQL 两套阈值判断分叉。
 *
 * 往返次数：常态 1 次（UPDATE ... RETURNING）；只有真正跨等级档位时才补一次
 * 条件写 tier，绝大多数消费不会触发。
 */
import { Prisma } from '@prisma/client';
import type { MarketingCustomerTier } from '@prisma/client';
import { calcCustomerTier } from '../../purely-profit/marketing/marketing.utils';
import { queryCustomerTierThresholds } from '../../purely-profit/marketing/marketing.query';

export interface ApplyCustomerMetricsParams {
  customerId: number;
  /** 限定门店档案，避免跨店误改他人账户 */
  storeId: number;
  /** 余额增量（分）：扣款传负数、退回传正数、不涉及传 0 */
  balanceDelta?: number;
  /** 余额必须 >= 该值才执行（扣款的最终防线，防止并发扣成负数） */
  requireBalanceGte?: number;
  /**
   * 积分增量：赚取为正、抵扣为负。
   *
   * 与余额 / 累计消费 / 到店次数写在**同一条 UPDATE** 里：扫码点餐落账原本是
   * 「扣抵扣积分 + 送消费积分 + 写指标」三次 UPDATE 同一行，等于同一行被反复
   * 加锁三次，事务内纯属浪费。
   */
  pointsDelta?: number;
  /** 积分必须 >= 该值才执行（抵扣的最终防线，防止并发扣成负数） */
  requirePointsGte?: number;
  /** 累计消费增量（分）：正常消费传正数，退款回滚传负数 */
  totalSpentDelta?: number;
  /** 到店次数增量：消费 +1，退款回滚 -1 */
  visitCountDelta?: number;
  /** 是否刷新 lastVisitAt；退款回滚保持「既成事实」不刷新 */
  touchLastVisitAt?: boolean;
  /** 是否要求档案 active（扫码点餐 / 自助点单口径） */
  requireActive?: boolean;
  /** 事务外预加载的等级阈值；不传则在本次更新后查一次门店配置 */
  tierThresholds?: { gold: number; diamond: number };
}

export interface CustomerMetricsSnapshot {
  totalSpent: number;
  visitCount: number;
  balance: number;
  points: number;
  tier: MarketingCustomerTier;
}

/**
 * 原子更新顾客消费指标并同步会员等级。
 *
 * @returns 更新后的指标快照；`null` 表示档案不存在 / 已软删 / 余额不足 / 非 active，
 *          由调用方按各自业务语义决定抛什么异常。
 */
export async function applyCustomerMetrics(
  tx: Prisma.TransactionClient,
  params: ApplyCustomerMetricsParams,
): Promise<CustomerMetricsSnapshot | null> {
  const {
    customerId,
    storeId,
    balanceDelta = 0,
    requireBalanceGte,
    pointsDelta = 0,
    requirePointsGte,
    totalSpentDelta = 0,
    visitCountDelta = 0,
    touchLastVisitAt = false,
    requireActive = false,
    tierThresholds,
  } = params;

  const rows = await tx.$queryRaw<
    Array<{
      total_spent: number;
      visit_count: number;
      balance: number;
      points: number;
      tier: MarketingCustomerTier;
    }>
  >`
    UPDATE marketing_customers
    SET balance = balance + ${balanceDelta},
        points = points + ${pointsDelta},
        total_spent = GREATEST(total_spent + ${totalSpentDelta}, 0),
        visit_count = GREATEST(visit_count + ${visitCountDelta}, 0),
        last_visit_at = CASE
          WHEN ${touchLastVisitAt} THEN NOW() AT TIME ZONE 'UTC'
          ELSE last_visit_at
        END,
        updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE id = ${customerId}
      AND store_id = ${storeId}
      AND deleted_at IS NULL
      ${requireActive ? Prisma.sql`AND status = 'active'` : Prisma.empty}
      ${
        requireBalanceGte === undefined
          ? Prisma.empty
          : Prisma.sql`AND balance >= ${requireBalanceGte}`
      }
      ${
        requirePointsGte === undefined
          ? Prisma.empty
          : Prisma.sql`AND points >= ${requirePointsGte}`
      }
    RETURNING total_spent, visit_count, balance, points, tier
  `;

  const row = rows[0];
  if (!row) return null;

  const totalSpent = Number(row.total_spent);
  const visitCount = Number(row.visit_count);
  const balance = Number(row.balance);
  const points = Number(row.points);

  // 指标没动就不必重算等级，省掉一次配置查询
  if (totalSpentDelta === 0 && visitCountDelta === 0) {
    return { totalSpent, visitCount, balance, points, tier: row.tier };
  }

  const thresholds =
    tierThresholds ?? (await queryCustomerTierThresholds(tx, storeId));
  const tier = calcCustomerTier(
    totalSpent,
    thresholds,
  ) as MarketingCustomerTier;

  // RETURNING 拿到的是未修改的 tier，同一事务内比较即可判断是否需要跨档写回
  if (row.tier !== tier) {
    await tx.marketingCustomer.updateMany({
      where: { id: customerId, storeId, tier: { not: tier } },
      data: { tier },
    });
  }

  return { totalSpent, visitCount, balance, points, tier };
}
