// 新用户额度读路径：概览聚合、流水、余额与消耗记录查询，以及两处数据库锁
//
// 「余额怎么读、扣减前加哪把锁」只有这一处实现：调额必须 SELECT ... FOR UPDATE
// （否则并发调额会丢失更新），扣减必须按 clubUserId 加事务级顾问锁（否则换店并发
// 首单会撞唯一键）。漏掉任何一处都会表现为「余额与流水对不上」这类难查的数据问题。
//
// 所有函数都显式接收 executor：读路径也会被建单事务调用，必须与事务内其它读写
// 共用同一连接，否则读不到尚未提交的扣减。
import type { PrismaExecutor } from '../platform-membership/platform-membership.types';
import {
  DEFAULT_QUOTA_LOG_LIMIT,
  QUOTA_CONSUME_LOCK_NAMESPACE,
} from './new-customer-quota.constants';
import { normalizeLogType } from './new-customer-quota.domain';
import type { NewCustomerQuotaLogItem } from './new-customer-quota.types';

/** 概览所需的四项统计（不含 storeId / 预警阈值，由 service 补上） */
export interface QuotaOverviewTotals {
  remaining: number;
  totalRecharged: number;
  totalGranted: number;
  totalConsumed: number;
}

/** 概览三查并行：档案余额 + 充值/赠送累计；档案缺失时全部归零 */
export async function readQuotaTotals(
  executor: PrismaExecutor,
  storeId: number,
): Promise<QuotaOverviewTotals> {
  const [profile, recharged, granted] = await Promise.all([
    executor.storeMembershipProfile.findUnique({
      where: { storeId },
      select: { newCustomerQuota: true, newCustomerQuotaConsumed: true },
    }),
    executor.storeNewCustomerQuotaLog.aggregate({
      where: { storeId, type: 'recharge' },
      _sum: { changeAmount: true },
    }),
    executor.storeNewCustomerQuotaLog.aggregate({
      where: { storeId, type: 'grant' },
      _sum: { changeAmount: true },
    }),
  ]);

  return {
    remaining: profile?.newCustomerQuota ?? 0,
    totalRecharged: recharged._sum.changeAmount ?? 0,
    totalGranted: granted._sum.changeAmount ?? 0,
    totalConsumed: profile?.newCustomerQuotaConsumed ?? 0,
  };
}

/** 本店剩余额度（位新客） */
export async function findRemainingQuota(
  executor: PrismaExecutor,
  storeId: number,
): Promise<number> {
  const profile = await executor.storeMembershipProfile.findUnique({
    where: { storeId },
    select: { newCustomerQuota: true },
  });
  return profile?.newCustomerQuota ?? 0;
}

/**
 * 该顾客是否已在**任意门店**消耗过额度（true = 老客）。
 *
 * 只看 clubUserId：手机号认证一位顾客一生只需一次，换店不该再扣一次额度。
 */
export async function hasConsumeRecord(
  executor: PrismaExecutor,
  clubUserId: number,
): Promise<boolean> {
  const existing = await executor.storeNewCustomerQuotaConsume.findUnique({
    where: { clubUserId },
    select: { id: true },
  });
  return existing !== null && existing !== undefined;
}

/** 额度流水（时间倒序） */
export async function listQuotaLogs(
  executor: PrismaExecutor,
  storeId: number,
  limit: number = DEFAULT_QUOTA_LOG_LIMIT,
): Promise<NewCustomerQuotaLogItem[]> {
  const logs = await executor.storeNewCustomerQuotaLog.findMany({
    where: { storeId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  return logs.map((log) => ({
    id: log.id,
    type: normalizeLogType(log.type),
    changeAmount: log.changeAmount,
    balanceAfter: log.balanceAfter,
    description: log.description,
    createdAt: log.createdAt.toISOString(),
  }));
}

/**
 * 扣减前按 clubUserId 加事务级顾问锁，把「查留痕 → 扣额度 → 写记录」串行化
 * （换店并发首单会撞全局唯一键，详见常量处说明）。xact 版本随事务提交/回滚
 * 自动释放，不需要显式解锁。
 */
export async function lockQuotaConsumeSlot(
  executor: PrismaExecutor,
  clubUserId: number,
): Promise<void> {
  await executor.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${QUOTA_CONSUME_LOCK_NAMESPACE}::int,
      ${clubUserId}::int
    )
  `;
}

/**
 * 调额前抢行锁并读余额：并发调额不能基于同一个旧余额各自写回。
 *
 * ⚠️ 不能拆成「findUnique 读 → 算出绝对值 → update 写回」：PostgreSQL 默认
 * READ COMMITTED，两个运营同时调同一家门店时会读到同一个旧余额，后提交者整体
 * 覆盖先提交者（丢失更新），且输的那条流水 changeAmount 与 balanceAfter 都是
 * 按旧余额算的，余额与流水从此对不上。这里刻意不用乐观锁重试：调额是低频写操作，
 * 一次行锁的代价远低于重试带来的复杂度。
 */
export async function lockRemainingQuota(
  executor: PrismaExecutor,
  storeId: number,
): Promise<number> {
  const lockedRows = await executor.$queryRaw<
    Array<{ remaining: number | bigint }>
  >`
    SELECT new_customer_quota AS remaining
    FROM store_membership_profiles
    WHERE store_id = ${storeId}
    FOR UPDATE
  `;

  return Number(lockedRows[0]?.remaining ?? 0);
}
