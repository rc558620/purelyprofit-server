// 新用户额度写路径：充值 / 会员赠送 / 清零 / 运营调额 / 新客消耗
//
// 每个导出函数都是一段**事务体**，由 service 决定是开新事务还是复用调用方连接
// （见 runQuotaWrite）。入参校验、文案组装与 HTTP 语义留在 service，这里只决定
// 「额度怎么改、流水怎么记」的落库顺序——两者共用同一张流水表，任何一处漏写
// 流水都会让商家端「余额 + 累计赠送 + 流水」三者对不上。
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
import type { PrismaExecutor } from '../platform-membership/platform-membership.types';
import {
  formatAmountFenToYuanDisplay,
  resolvePlanGrantLabel,
} from './new-customer-quota.domain';
import {
  findRemainingQuota,
  hasConsumeRecord,
  lockQuotaConsumeSlot,
  lockRemainingQuota,
} from './new-customer-quota.query';
import { buildQuotaExhaustedException } from './new-customer-quota.shared';
import type {
  ConsumeNewCustomerQuotaResult,
  QuotaAdjustWriteParams,
  QuotaClearWriteParams,
  QuotaConsumeWriteParams,
  QuotaGrantWriteParams,
  QuotaRechargeWriteParams,
} from './new-customer-quota.types';

/**
 * 执行一段额度写操作：调用方已在事务里就直接复用连接，否则开一个独立事务。
 *
 * 事务客户端没有 `$transaction` 可嵌套，且在已持有 `storeMembershipProfile`
 * 行锁的事务里再开独立事务会互相等待，所以必须判断 executor 的身份。
 */
export async function runQuotaWrite<T>(
  prisma: PrismaService,
  executor: PrismaExecutor,
  write: (tx: PrismaExecutor) => Promise<T>,
): Promise<T> {
  if (executor !== prisma) return write(executor);
  return prisma.$transaction(write, { timeout: TX_TIMEOUT_MEDIUM });
}

/** 门店可能从未充值/赠送过（无档案行）：写额度前先补一行 */
async function ensureQuotaProfile(
  tx: PrismaExecutor,
  storeId: number,
): Promise<void> {
  await tx.storeMembershipProfile.upsert({
    where: { storeId },
    create: { storeId },
    update: {},
  });
}

/**
 * 充值到账：叠加额度 + 写充值流水。
 *
 * 幂等：同一支付单号只入账一次。
 * 支付单的「置 paid」与入账已拆成两段事务（钱先落定、入账可重试），
 * 微信重投或补偿重试会再次走到这里，必须靠支付单号自己挡住重复加额度。
 */
export async function writeRecharge(
  tx: PrismaExecutor,
  params: QuotaRechargeWriteParams,
): Promise<void> {
  const { storeId, amountFen, quotaCount, orderId, payMode } = params;

  const settled = await tx.storeNewCustomerQuotaLog.findFirst({
    where: { storeId, orderId },
    select: { id: true },
  });
  if (settled) {
    return;
  }

  await ensureQuotaProfile(tx, storeId);

  const updated = await tx.storeMembershipProfile.update({
    where: { storeId },
    data: { newCustomerQuota: { increment: quotaCount } },
    select: { newCustomerQuota: true },
  });

  await tx.storeNewCustomerQuotaLog.create({
    data: {
      storeId,
      type: 'recharge',
      changeAmount: quotaCount,
      balanceAfter: updated.newCustomerQuota,
      amountFen,
      orderId,
      // 测试模式没有真实微信流水，写成「微信支付充值」会让商家对账时找不到对应的微信交易
      description:
        payMode === 'test'
          ? `测试模式充值 ${formatAmountFenToYuanDisplay(amountFen)}（未真实扣款）`
          : `微信支付充值 ${formatAmountFenToYuanDisplay(amountFen)}`,
    },
  });
}

/**
 * 会员赠送：叠加额度 + 写赠送流水。
 *
 * 必须走 **increment 叠加**并并入调用方事务：与外层写档案的操作不在同一事务里时，
 * 中途失败重试会重复赠送。
 */
export async function writeGrant(
  tx: PrismaExecutor,
  params: QuotaGrantWriteParams,
): Promise<void> {
  const { storeId, planId, quotaCount, periodCount } = params;

  await ensureQuotaProfile(tx, storeId);

  const updated = await tx.storeMembershipProfile.update({
    where: { storeId },
    data: { newCustomerQuota: { increment: quotaCount } },
    select: { newCustomerQuota: true },
  });

  await tx.storeNewCustomerQuotaLog.create({
    data: {
      storeId,
      type: 'grant',
      changeAmount: quotaCount,
      balanceAfter: updated.newCustomerQuota,
      description: `${resolvePlanGrantLabel(planId)}赠送${
        periodCount > 1 ? ` ×${periodCount}` : ''
      }`,
    },
  });
}

/** 清零：余额置 0 + 写清零流水；余额已为 0 时不产生噪音流水 */
export async function writeClear(
  tx: PrismaExecutor,
  params: QuotaClearWriteParams,
): Promise<void> {
  const { storeId, description } = params;

  const remaining = await findRemainingQuota(tx, storeId);
  if (remaining <= 0) return;

  await tx.storeMembershipProfile.update({
    where: { storeId },
    data: { newCustomerQuota: 0 },
  });

  await tx.storeNewCustomerQuotaLog.create({
    data: {
      storeId,
      type: 'clear',
      changeAmount: -remaining,
      balanceAfter: 0,
      description,
    },
  });
}

/**
 * 运营调额：按增量调整余额（不会低于 0）+ 写 admin_adjust 流水。
 *
 * 余额未发生变化时（例如已是 0 仍继续减少）不写流水，避免产生 0 变动的噪音记录。
 *
 * @returns 调整后的余额
 */
export async function adjustQuotaWithinTx(
  tx: PrismaExecutor,
  params: QuotaAdjustWriteParams,
): Promise<number> {
  const { storeId, delta, description } = params;

  await ensureQuotaProfile(tx, storeId);

  const remaining = await lockRemainingQuota(tx, storeId);
  const nextQuota = Math.max(0, remaining + delta);
  const changeAmount = nextQuota - remaining;
  if (changeAmount === 0) return nextQuota;

  await tx.storeMembershipProfile.update({
    where: { storeId },
    data: { newCustomerQuota: nextQuota },
  });

  await tx.storeNewCustomerQuotaLog.create({
    data: {
      storeId,
      type: 'admin_adjust',
      changeAmount,
      balanceAfter: nextQuota,
      description,
    },
  });

  return nextQuota;
}

/**
 * 新客消耗：同一顾客（clubUserId）**全局只扣一次**。
 *
 * 并发正确性靠两点，不需要额外的锁表：
 * - `updateMany` 的 `newCustomerQuota: { gt: 0 }` 条件 + PostgreSQL 行锁：
 *   两个新客争抢最后一个额度时，先到者把额度扣到 0 并提交，后到者的 UPDATE
 *   在锁释放后重新评估 WHERE（READ COMMITTED），条件不再满足 → count=0 → 抛错；
 * - `storeNewCustomerQuotaConsume.clubUserId` 的**全局唯一**约束保证同一顾客
 *   换多少家店都只会被记一次账。
 *
 * ⚠️ 老客必须在写入之前用查询识别出来，不能靠「insert 撞唯一约束再兜」：
 * PostgreSQL 下事务内一旦触发 P2002，整个事务进入 aborted 状态、后续语句全部
 * 失败，会把老客的整笔建单一起拖垮。
 */
export async function writeConsume(
  tx: PrismaExecutor,
  params: QuotaConsumeWriteParams,
): Promise<ConsumeNewCustomerQuotaResult> {
  const { storeId, clubUserId, phone } = params;

  // 同一顾客的并发扣减串行化（换店并发首单会撞全局唯一键，详见常量处说明）
  await lockQuotaConsumeSlot(tx, clubUserId);

  // 老客（任意门店已消耗过额度）：直接放行，不做任何写入
  if (await hasConsumeRecord(tx, clubUserId)) {
    return {
      consumed: false,
      remaining: await findRemainingQuota(tx, storeId),
    };
  }

  // 新客：抢占 1 个额度（额度为 0 时命中 0 行 → 抛错回滚）
  const updated = await tx.storeMembershipProfile.updateMany({
    where: { storeId, newCustomerQuota: { gt: 0 } },
    data: {
      newCustomerQuota: { decrement: 1 },
      newCustomerQuotaConsumed: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    throw buildQuotaExhaustedException();
  }

  await tx.storeNewCustomerQuotaConsume.create({
    data: { storeId, clubUserId, phone },
  });

  const remaining = await findRemainingQuota(tx, storeId);

  await tx.storeNewCustomerQuotaLog.create({
    data: {
      storeId,
      type: 'consume',
      changeAmount: -1,
      balanceAfter: remaining,
      // 消耗点不再只有「授权手机号」：下单（扫码点餐 / 自助下单 / 团购券 /
      // 服务商品）同样扣减，且这些链路并不强制绑定手机号，
      // 写成「授权手机号消耗」会让商家在流水里看到与事实不符的描述。
      description: '新客消耗',
    },
  });

  return { consumed: true, remaining };
}
