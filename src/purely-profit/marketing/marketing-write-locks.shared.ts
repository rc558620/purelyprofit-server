// 营销写路径锁原语：顾客余额行锁 + 门店维度 advisory lock。
//
// 背景：`20261007100000_sync_local_drift_baseline` 已把「同店有效手机号唯一」
// 与「同店同类型启用活动唯一」两个部分唯一索引判为漂移删除，Prisma schema 也
// 只能表达普通索引（不支持 partial unique），因此并发安全不能依赖 P2002。
// 这里用两把锁补回数据库级串行化，避免「先查后写」在并发下同时通过。
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** 顾客写锁命名空间（与库内其它 advisory lock 以第一个 int4 key 隔离） */
export const MARKETING_CUSTOMER_WRITE_LOCK_NAMESPACE = 1018;

/** 活动写锁命名空间 */
export const MARKETING_PROMOTION_WRITE_LOCK_NAMESPACE = 1019;

/** 单个顾客的资金写锁命名空间 */
export const MARKETING_CUSTOMER_ROW_LOCK_NAMESPACE = 1020;

export interface LockedMarketingCustomerRow {
  id: number;
  balance: number;
  points: number;
}

/**
 * 同门店顾客建档 / 手机号变更串行化。
 *
 * 锁粒度取 storeId：建档是低频写，按门店排队不会成为瓶颈，却能保证
 * `ensureUniquePhone` 的「查」与随后的「写」之间没有并发窗口。
 */
export const lockMarketingCustomerScope = async (
  tx: Prisma.TransactionClient,
  storeId: number,
): Promise<void> => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MARKETING_CUSTOMER_WRITE_LOCK_NAMESPACE}, ${storeId})`;
};

/** 同门店活动创建 / 编辑 / 启停串行化（同上，锁粒度取 storeId） */
export const lockMarketingPromotionScope = async (
  tx: Prisma.TransactionClient,
  storeId: number,
): Promise<void> => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MARKETING_PROMOTION_WRITE_LOCK_NAMESPACE}, ${storeId})`;
};

/**
 * 锁定单个顾客的资金写入口，并返回锁后的最新余额 / 积分。
 *
 * 用事务级 advisory lock（按顾客 ID）串行化充值、退款、积分调整与删档：
 * 锁内读取的余额一定是最新提交值，后续计算与写入不会被并发事务穿插，
 * 重复清零赠送、超额退款、向已删除档案写入这三类问题一并消除。
 *
 * 锁条件里带 `deleted_at IS NULL`：已删除档案拒绝一切后续资金写入。
 */
export const lockMarketingCustomerRow = async (
  tx: Prisma.TransactionClient,
  customerId: number,
): Promise<LockedMarketingCustomerRow> => {
  await tx.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(${MARKETING_CUSTOMER_ROW_LOCK_NAMESPACE}, ${customerId})`,
  );

  const row = await tx.marketingCustomer.findUnique({
    where: { id: customerId },
    select: { id: true, balance: true, points: true, deletedAt: true },
  });
  if (!row || row.deletedAt) {
    throw new BadRequestException('顾客不存在或已被删除');
  }
  return { id: row.id, balance: row.balance, points: row.points };
};
