import { BadRequestException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type { PrismaExecutor } from './platform-membership.types';
import {
  claimPendingDealRow,
  clearSubAccountColumns,
  createDealRow,
  deleteDealRowsWithoutOverride,
  findRenewalOverride,
  revokeDealRowsKeepingOverride,
  updateSubAccountColumns,
  upsertDealRow,
  upsertRenewalOverride,
} from './store-membership-locked-price.query';
import {
  isInvalidFenValue,
  logLockedPriceEvent,
  validateDealPrice,
  validateSubAccountSnapshot,
} from './store-membership-locked-price.shared';
import type {
  DealPriceWriteParams,
  RenewalPriceOverrideWriteParams,
  SubAccountSnapshotWriteParams,
} from './store-membership-locked-price.types';

/**
 * 成交价快照的**写路径编排**：校验 → 结构化日志 → 落库。
 *
 * 每个函数对应 service 上的一个对外方法，固定三步顺序，让「哪些值被拦下、
 * 哪些变更留了痕、最终写了哪些列」只有一处实现。SQL 一律在本文件之外
 * （`.query.ts`），校验在 `.shared.ts`，本文件只决定它们的**调用次序**。
 *
 * 所有函数都显式接收 `logger` 与 `executor`：写路径可能被下单事务调用，
 * 必须与事务内其它读写共用同一 executor，日志也要带上发起方的 Logger 名。
 */

/**
 * 首次成交写入：已**成交**过的档位不覆盖（「首充锁定」语义），返回 false 表示
 * 沿用原成交价。
 *
 * ⚠️ 「是否已成交」以 `dealLockedAt` 为准，**不是**「行是否存在」：
 * 运营先在管理端议定续费价时，`writeRenewalPriceOverride` 会为尚无成交的档位
 * 建一行占位行（`dealLockedAt` 为空、price 抄的是当时的配置价）。若沿用
 * `createMany + skipDuplicates`，这类行会挡住商家首次成交的写入——
 * 真实成交价与 `source: purchase` 永久丢失，快照里留下一个假成交价。
 * 因此先尝试「认领占位行」，只有行确实不存在时才新建。
 */
export async function writeFirstDealPrice(
  logger: Logger,
  executor: PrismaExecutor,
  params: DealPriceWriteParams,
): Promise<boolean> {
  if (!validateDealPrice(logger, params)) {
    return false;
  }

  // 先认领「尚未成交」的行：它可能只是运营议定续费价时建的占位行，
  // 必须让首笔成交的真实金额与来源落进去
  const claimedCount = await claimPendingDealRow(executor, params);

  if (claimedCount > 0) {
    return true;
  }

  // 行不存在才新建；并发下由唯一键 + skipDuplicates 兜底（不会覆盖已成交的行）
  return (await createDealRow(executor, params)) > 0;
}

/**
 * **覆盖**写入成交价（管理端「设置会员等级」是一次显式成交，运营填的价格必须
 * 立即生效，否则会出现「改了价却查不到效果」）。
 */
export async function writeDealPriceUpsert(
  logger: Logger,
  executor: PrismaExecutor,
  params: DealPriceWriteParams,
): Promise<void> {
  if (!validateDealPrice(logger, params)) {
    return;
  }

  logLockedPriceEvent(logger, 'store_membership_deal_price_upsert', {
    storeId: params.storeId,
    planId: params.planId,
    price: params.price,
    subAccountAmount: params.subAccountAmount ?? null,
    subAccountCount: params.subAccountCount ?? null,
    source: params.source,
  });

  await upsertDealRow(executor, params);
}

/**
 * 重置成交价快照；不传 planId 时清空门店全部。返回清除条数。
 *
 * ⚠️ **不得整行删除**：`renewalPriceOverride`（运营议定的续费价）与成交分量
 * 同住一行，整行删掉会让门店静默回落到配置价续费——议定价**高于**配置价时
 * 平台白丢一块收入，且没有任何提示。因此按有无议定价分两类处理：
 * - 无议定价：整行删除，下次成交重新锁价；
 * - 有议定价：保留该行，只作废成交分量（`dealLockedAt` 置空 + 子账号分量清空），
 *   续费价维持运营议定的口径。
 */
export async function resetStoreLockedPrices(
  logger: Logger,
  executor: PrismaExecutor,
  storeId: number,
  planId?: PlatformMembershipPlanId,
): Promise<number> {
  const baseWhere = planId ? { storeId, planId } : { storeId };

  // 顺序：先作废（护住覆盖价），再删除。两步条件互斥且都只依赖 where，
  // 重复调用幂等；任一步失败都不会把运营议定的续费价丢掉。
  const revokedCount = await revokeDealRowsKeepingOverride(executor, baseWhere);
  const deletedCount = await deleteDealRowsWithoutOverride(executor, baseWhere);

  const clearedCount = revokedCount + deletedCount;

  if (clearedCount > 0) {
    logLockedPriceEvent(logger, 'store_membership_locked_price_reset', {
      storeId,
      planId: planId ?? null,
      clearedCount,
      // 分开记：被作废的行仍保留覆盖价，排查「重置后价格没变」时看这里
      revokedCount,
      deletedCount,
    });
  }

  return clearedCount;
}

/**
 * 清空门店的子账号加价：关闭子账号能力后不应继续收子账号的钱。
 *
 * 只置空子账号两列，**保留** `price` 成交总额——于是续费价退化成纯配置价
 * （成交总额不参与定价，保留它只为对账与快照展示）。返回受影响行数。
 */
export async function clearStoreSubAccountAmounts(
  logger: Logger,
  executor: PrismaExecutor,
  storeId: number,
): Promise<number> {
  const clearedCount = await clearSubAccountColumns(executor, storeId);

  if (clearedCount > 0) {
    logLockedPriceEvent(logger, 'store_membership_sub_account_amount_cleared', {
      storeId,
      clearedCount,
    });
  }

  return clearedCount;
}

/**
 * 补录 / 撤销子账号加价：**只动子账号字段，不碰成交总额**。返回是否有行被更新
 * （false 表示该门店该档位没有成交记录，补录无从附着）。
 */
export async function writeSubAccountSnapshot(
  logger: Logger,
  executor: PrismaExecutor,
  params: SubAccountSnapshotWriteParams,
): Promise<boolean> {
  if (!validateSubAccountSnapshot(logger, params)) {
    return false;
  }

  logLockedPriceEvent(
    logger,
    'store_membership_sub_account_amount_backfilled',
    {
      storeId: params.storeId,
      planId: params.planId,
      subAccountAmount: params.subAccountAmount,
      subAccountCount: params.subAccountCount,
    },
  );

  return (await updateSubAccountColumns(executor, params)) > 0;
}

/**
 * 写入 / 清除某个门店某档位的**续费价覆盖**，返回写入前的旧值。
 *
 * 与 `writeDealPriceUpsert`（设置会员等级）的关键区别：
 * - 本函数只动 `renewalPriceOverride`，**不触碰** `price` / `subAccountAmount`
 *   / `subAccountCount`，因此不会污染成交记账，也不会因为一次「设置会员等级」
 *   就把运营议定的覆盖价清掉。
 * - 传 `null` 表示清除覆盖、恢复标准口径（配置价 + 子账号加价）。传入的价位
 *   **低于当前配置价**时照常落库，但按取高者口径不会生效——等配置价回落到它
 *   之下才重新生效，因此不做丢弃也不做裁剪。
 * - 覆盖价非法是运营填错，直接抛 `BadRequestException`：静默忽略会让运营以为
 *   议价已生效。
 */
export async function writeRenewalPriceOverride(
  logger: Logger,
  executor: PrismaExecutor,
  params: RenewalPriceOverrideWriteParams,
): Promise<{ oldPrice: number | null }> {
  const { storeId, planId, overridePrice } = params;

  if (isInvalidFenValue(overridePrice)) {
    logger.warn(
      `[locked-price] 忽略非法续费价覆盖 storeId=${storeId} planId=${planId} overridePrice=${overridePrice}`,
    );
    throw new BadRequestException('续费价必须是非负整数（分）');
  }

  const oldPrice = await findRenewalOverride(executor, storeId, planId);

  // 无变化就不写库：避免产生一条没有实际变更的审计记录
  if (oldPrice === overridePrice) {
    return { oldPrice };
  }

  await upsertRenewalOverride(executor, params);

  logLockedPriceEvent(
    logger,
    'store_membership_renewal_price_override_upsert',
    { storeId, planId, oldPrice, newPrice: overridePrice },
  );

  return { oldPrice };
}
