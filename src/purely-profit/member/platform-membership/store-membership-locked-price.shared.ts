import type { Logger } from '@nestjs/common';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type {
  DealPriceSnapshotTables,
  LockedPriceAuditRow,
  LockedPriceRow,
  LockedPriceSnapshot,
} from './store-membership-locked-price.types';

/**
 * 本行是否来自**真实成交**。
 *
 * 判据是 `dealLockedAt`，不是「行是否存在」：运营在管理端议定续费价时会先建一行
 * 占位行（`dealLockedAt` 为空、`price` 只是建行时抄的配置价），它既不能进
 * 「成交价快照」展示，也不能拦住商家首次成交的写入。
 *
 * `typeof === 'undefined'` 兜底：mock 残行 / 漏 select 的行该字段为 undefined，
 * 此时按「已成交」处理，不改变旧行为。
 */
export function hasRealDeal(
  row: Pick<LockedPriceRow, 'dealLockedAt'>,
): boolean {
  return typeof row.dealLockedAt === 'undefined' || row.dealLockedAt !== null;
}

/**
 * 金额分量是否非法：必须是非负整数（分）。
 *
 * `undefined`（本次不动这个字段）与 `null`（置空）都是合法取值，
 * 只有真正传了数字才校验——否则负的加价会把标准总价算小。
 */
export function isInvalidFenValue(value: number | null | undefined): boolean {
  return (
    value !== undefined &&
    value !== null &&
    (!Number.isInteger(value) || value < 0)
  );
}

/**
 * 把成交价快照行归集成定价公式所需的四张表。
 *
 * - `prices`：成交总额，只作记账 / 快照展示，不参与定价
 * - `priceOverrides`：运营议定的基础价，与当前配置价**取高者**作为定价基数
 * - `subAccountAmounts` / `subAccountCounts`：子账号加价与数量
 *
 * 后三张表**只收录已录入的行**：缺失与该 key 不存在等价（按 0 处理），
 * 存量为 `null` 的数据因此自动回退旧口径，不会被误判成「这家店子账号不要钱」。
 *
 * 用 `typeof === 'number'` 而非 `!== null` 兜底：select 漏字段、或是 mock 返回
 * 残行时值是 undefined，`!== null` 会让 undefined 混进表里。
 */
export function collectDealPriceSnapshots(
  rows: readonly LockedPriceRow[],
): DealPriceSnapshotTables {
  const prices = new Map<PlatformMembershipPlanId, number>();
  const priceOverrides = new Map<PlatformMembershipPlanId, number>();
  const subAccountAmounts = new Map<PlatformMembershipPlanId, number>();
  const subAccountCounts = new Map<PlatformMembershipPlanId, number>();

  for (const row of rows) {
    // 成交总额只收录真正成交过的行：占位行的 price 是建行时抄的配置价，
    // 收进来会被当成该门店的成交价
    if (hasRealDeal(row)) {
      prices.set(row.planId, row.price);
    }
    if (typeof row.subAccountAmount === 'number') {
      subAccountAmounts.set(row.planId, row.subAccountAmount);
    }
    if (typeof row.subAccountCount === 'number') {
      subAccountCounts.set(row.planId, row.subAccountCount);
    }
    if (typeof row.renewalPriceOverride === 'number') {
      priceOverrides.set(row.planId, row.renewalPriceOverride);
    }
  }

  return { prices, priceOverrides, subAccountAmounts, subAccountCounts };
}

/**
 * 快照行 → 管理端展示条目；只保留**确实成交过**的行。
 *
 * 仅为承载续费价覆盖而建的占位行（`dealLockedAt` 为空）会被剔除——
 * 它的 `price` 只是建行时抄的配置价，当成成交价展示会误导运营。
 */
export function toLockedPriceSnapshots(
  rows: readonly LockedPriceAuditRow[],
): LockedPriceSnapshot[] {
  return rows.filter(hasRealDeal).map((row) => ({
    planId: row.planId,
    price: row.price,
    subAccountAmount: row.subAccountAmount,
    subAccountCount: row.subAccountCount,
    renewalPriceOverride: row.renewalPriceOverride,
    source: row.source,
    lockedAt: row.lockedAt,
  }));
}

/**
 * 结构化日志：本文件所有写操作都按「一行 JSON、带 event 名」落 warn，
 * 便于按事件名检索「谁在什么时候改了这家店的价」。
 */
export function logLockedPriceEvent(
  logger: Logger,
  event: string,
  payload: Record<string, unknown>,
): void {
  logger.warn(JSON.stringify({ event, ...payload }));
}

/**
 * 校验成交价与子账号分量；非法值只告警不写入。
 *
 * 子账号分量同样是定价公式的输入，非法值会让标准总价被算小，
 * 必须与 `price` 一样拦在写入之前。
 */
export function validateDealPrice(
  logger: Logger,
  params: {
    storeId: number;
    planId: PlatformMembershipPlanId;
    price: number;
    subAccountAmount?: number | null;
    subAccountCount?: number | null;
  },
): boolean {
  const { storeId, planId, price, subAccountAmount, subAccountCount } = params;

  if (isInvalidFenValue(price)) {
    logger.warn(
      `[locked-price] 忽略非法成交价 storeId=${storeId} planId=${planId} price=${price}`,
    );
    return false;
  }

  if (
    isInvalidFenValue(subAccountAmount) ||
    isInvalidFenValue(subAccountCount)
  ) {
    logger.warn(
      `[locked-price] 忽略非法子账号分量 storeId=${storeId} planId=${planId} subAccountAmount=${subAccountAmount} subAccountCount=${subAccountCount}`,
    );
    return false;
  }

  return true;
}

/** 子账号两列必须都是非负整数或 null；null 表示撤销补录 */
export function validateSubAccountSnapshot(
  logger: Logger,
  params: {
    storeId: number;
    planId: PlatformMembershipPlanId;
    subAccountAmount: number | null;
    subAccountCount: number | null;
  },
): boolean {
  const { storeId, planId, subAccountAmount, subAccountCount } = params;

  // 数量与加价同源，同样要拦：写进负数 / 小数会让续费卡展示「包含 -1 个子账号」
  if (isInvalidFenValue(subAccountAmount)) {
    logger.warn(
      `[locked-price] 忽略非法子账号加价 storeId=${storeId} planId=${planId} subAccountAmount=${subAccountAmount}`,
    );
    return false;
  }

  if (isInvalidFenValue(subAccountCount)) {
    logger.warn(
      `[locked-price] 忽略非法子账号数量 storeId=${storeId} planId=${planId} subAccountCount=${subAccountCount}`,
    );
    return false;
  }

  return true;
}
