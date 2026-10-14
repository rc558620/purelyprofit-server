import { SUB_ACCOUNT_PRICING_PLAN_IDS } from './platform-membership.constants';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type { PrismaExecutor } from './platform-membership.types';
import type {
  DealPriceWriteParams,
  LockedPriceAuditRow,
  LockedPriceRow,
  RenewalPriceOverrideWriteParams,
  SubAccountSnapshotWriteParams,
} from './store-membership-locked-price.types';

/**
 * 成交价快照表的全部读写。
 *
 * 集中在这里是为了让「哪些列被写、哪些行被删」只有一处实现：
 * 运营议定的续费价（`renewalPriceOverride`）与成交分量同住一行，
 * 任何一处漏判都会让议定价被静默清掉。
 *
 * 所有函数都显式接收 executor：`lockPriceOnFirstDeal` / `upsertDealPrice`
 * 等可能被下单事务调用，必须与事务内其它读写作废同一快照。
 */

/** 成交分量四列 + 成交时点：定价与归集所需的最小投影 */
const DEAL_ROW_SELECT = {
  planId: true,
  price: true,
  subAccountAmount: true,
  subAccountCount: true,
  renewalPriceOverride: true,
  dealLockedAt: true,
} as const;

/** 管理端展示再多要来源与锁定时点 */
const AUDIT_ROW_SELECT = {
  ...DEAL_ROW_SELECT,
  source: true,
  lockedAt: true,
} as const;

/** Prisma 的 planId 是 MembershipPlanCycle 枚举，这里统一收敛成联合字面量类型 */
function toPlanId(planId: string): PlatformMembershipPlanId {
  return planId as PlatformMembershipPlanId;
}

/** 读取门店成交价快照行（定价 / 归集口径） */
export async function findDealPriceRows(
  executor: PrismaExecutor,
  storeId: number,
): Promise<LockedPriceRow[]> {
  const rows = await executor.storeMembershipLockedPrice.findMany({
    where: { storeId },
    select: DEAL_ROW_SELECT,
  });

  return rows.map((row) => ({ ...row, planId: toPlanId(row.planId) }));
}

/** 读取门店成交价快照行（管理端展示口径，含来源与锁定时点） */
export async function findLockedPriceAuditRows(
  executor: PrismaExecutor,
  storeId: number,
): Promise<LockedPriceAuditRow[]> {
  const rows = await executor.storeMembershipLockedPrice.findMany({
    where: { storeId },
    select: AUDIT_ROW_SELECT,
    orderBy: { planId: 'asc' },
  });

  return rows.map((row) => ({ ...row, planId: toPlanId(row.planId) }));
}

/**
 * 认领占位行：把首笔真实成交写进「已建行但尚未成交」的那一行。
 *
 * ⚠️ 首充不能用 `createMany + skipDuplicates` 一把梭：运营先议定续费价时建的
 * 占位行会挡住写入，真实成交价与 `source: purchase` 永久丢失。
 *
 * 只在调用方明确给了分量时才写子账号两列：占位行上可能已有运营「补录」的加价，
 * 首笔成交只负责补上成交金额与来源，不该把议定好的分量抹成 null。
 */
export async function claimPendingDealRow(
  executor: PrismaExecutor,
  params: DealPriceWriteParams,
): Promise<number> {
  const { storeId, planId, price, source, subAccountAmount, subAccountCount } =
    params;

  const claimed = await executor.storeMembershipLockedPrice.updateMany({
    where: { storeId, planId, dealLockedAt: null },
    data: {
      price,
      source,
      lockedAt: new Date(),
      dealLockedAt: new Date(),
      ...(typeof subAccountAmount === 'number' ? { subAccountAmount } : {}),
      ...(typeof subAccountCount === 'number' ? { subAccountCount } : {}),
    },
  });

  return claimed.count;
}

/** 行确实不存在时才新建；并发下由唯一键 + skipDuplicates 兜底（不会覆盖已成交行） */
export async function createDealRow(
  executor: PrismaExecutor,
  params: DealPriceWriteParams,
): Promise<number> {
  const { storeId, planId, price, source, subAccountAmount, subAccountCount } =
    params;

  const created = await executor.storeMembershipLockedPrice.createMany({
    data: [
      {
        storeId,
        planId,
        price,
        subAccountAmount: subAccountAmount ?? null,
        subAccountCount: subAccountCount ?? null,
        source,
        dealLockedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });

  return created.count;
}

/**
 * 覆盖写入成交分量（管理端「设置会员等级」是一次显式成交）。
 *
 * ⚠️ 这里**绝不能**顺手清掉 `renewalPriceOverride`：成交记账与运营议定的覆盖价
 * 生命周期不同，写 null 会让运营议的价静默蒸发。
 */
export async function upsertDealRow(
  executor: PrismaExecutor,
  params: DealPriceWriteParams,
): Promise<void> {
  const { storeId, planId, price, source, subAccountAmount, subAccountCount } =
    params;

  await executor.storeMembershipLockedPrice.upsert({
    where: { storeId_planId: { storeId, planId } },
    create: {
      storeId,
      planId,
      price,
      subAccountAmount: subAccountAmount ?? null,
      subAccountCount: subAccountCount ?? null,
      source,
      dealLockedAt: new Date(),
    },
    update: {
      price,
      source,
      // 一次显式成交：既刷新成交时点，也把「仅承载覆盖价」的占位行转成正式成交行
      lockedAt: new Date(),
      dealLockedAt: new Date(),
      ...(subAccountAmount !== undefined ? { subAccountAmount } : {}),
      ...(subAccountCount !== undefined ? { subAccountCount } : {}),
    },
  });
}

/**
 * 作废成交分量但**保留行**：只清 `dealLockedAt` 与子账号两列，
 * 护住同行的 `renewalPriceOverride`（运营议定的续费价）。
 */
export async function revokeDealRowsKeepingOverride(
  executor: PrismaExecutor,
  where: { storeId: number; planId?: PlatformMembershipPlanId },
): Promise<number> {
  const result = await executor.storeMembershipLockedPrice.updateMany({
    where: { ...where, renewalPriceOverride: { not: null } },
    data: {
      dealLockedAt: null,
      subAccountAmount: null,
      subAccountCount: null,
    },
  });

  return result.count;
}

/** 整行删除：只删**没有**议定价的行，有议定价的行已被上一步护住 */
export async function deleteDealRowsWithoutOverride(
  executor: PrismaExecutor,
  where: { storeId: number; planId?: PlatformMembershipPlanId },
): Promise<number> {
  const result = await executor.storeMembershipLockedPrice.deleteMany({
    where: { ...where, renewalPriceOverride: null },
  });

  return result.count;
}

/**
 * 清空门店的子账号加价与数量（关闭子账号能力后不应继续收这份钱）。
 *
 * 两列任一非空都要清：只判 `subAccountAmount` 会漏掉
 * 「数量已录入、加价仍是 NULL」的行，关掉子账号后数量却还挂着。
 */
export async function clearSubAccountColumns(
  executor: PrismaExecutor,
  storeId: number,
): Promise<number> {
  const result = await executor.storeMembershipLockedPrice.updateMany({
    where: {
      storeId,
      OR: [
        { subAccountAmount: { not: null } },
        { subAccountCount: { not: null } },
      ],
    },
    data: { subAccountAmount: null, subAccountCount: null },
  });

  return result.count;
}

/** 只动子账号两列，不碰成交总额 */
export async function updateSubAccountColumns(
  executor: PrismaExecutor,
  params: SubAccountSnapshotWriteParams,
): Promise<number> {
  const { storeId, planId, subAccountAmount, subAccountCount } = params;

  const result = await executor.storeMembershipLockedPrice.updateMany({
    where: { storeId, planId },
    data: { subAccountAmount, subAccountCount },
  });

  return result.count;
}

/** 读取「曾开通子账号功能」的门店（到期不失效，因此直接查档案配额） */
async function findSubAccountFeatureStoreIds(
  executor: PrismaExecutor,
  storeIds: number[],
): Promise<number[]> {
  const profiles = await executor.storeMembershipProfile.findMany({
    where: { storeId: { in: storeIds }, pulseSubAccountQuota: { gt: 0 } },
    select: { storeId: true },
  });

  return profiles.map((profile) => profile.storeId);
}

/**
 * 在已收窄的门店范围内找出**待补录子账号加价**的门店。
 *
 * 判据必须限定在年 / 永久档位内：月 / 季会员开不了子账号，它们的快照永远不需要
 * 补录，不该把门店捞进清单。
 */
async function findPendingBackfillStoreIds(
  executor: PrismaExecutor,
  scopedStoreIds: number[],
): Promise<number[]> {
  const pendingRows = await executor.storeMembershipLockedPrice.findMany({
    where: {
      storeId: { in: scopedStoreIds },
      planId: { in: [...SUB_ACCOUNT_PRICING_PLAN_IDS] },
      subAccountAmount: null,
    },
    select: { storeId: true },
    distinct: ['storeId'],
  });

  return pendingRows.map((row) => row.storeId);
}

/** 审计表里「改过价」的门店（新建与清除都记，值没变则整批跳过） */
async function findAuditedStoreIds(
  executor: PrismaExecutor,
  storeIds: number[],
): Promise<number[]> {
  const auditRows = await executor.storeMembershipPriceOverrideAudit.findMany({
    where: { storeId: { in: storeIds } },
    select: { storeId: true },
    distinct: ['storeId'],
  });

  return auditRows.map((row) => row.storeId);
}

/** 当前仍有覆盖价的门店：审计若按保留期被清理，这里兜底 */
async function findStoreIdsWithOverride(
  executor: PrismaExecutor,
  storeIds: number[],
): Promise<number[]> {
  const overrideRows = await executor.storeMembershipLockedPrice.findMany({
    where: { storeId: { in: storeIds }, renewalPriceOverride: { not: null } },
    select: { storeId: true },
    distinct: ['storeId'],
  });

  return overrideRows.map((row) => row.storeId);
}

/** 读取该档位当前的覆盖价（用于「无变化就不写库」与审计旧值） */
export async function findRenewalOverride(
  executor: PrismaExecutor,
  storeId: number,
  planId: PlatformMembershipPlanId,
): Promise<number | null> {
  const existing = await executor.storeMembershipLockedPrice.findUnique({
    where: { storeId_planId: { storeId, planId } },
    select: { renewalPriceOverride: true },
  });

  return existing?.renewalPriceOverride ?? null;
}

/**
 * 写入 / 清除续费价覆盖。
 *
 * 只动 `renewalPriceOverride`，**不触碰** `price` / `subAccountAmount`
 * / `subAccountCount`，因此不会污染成交记账，也不会因为一次「设置会员等级」
 * 就把运营议定的覆盖价清掉。
 *
 * 门店首次覆盖时该档位可能还没有成交快照行，因此用 upsert 建行：
 * `price` 以当前配置价兜底（纯记账占位，不参与定价），`source` 写 admin，
 * 且**刻意不写 `dealLockedAt`** —— 本行此刻只是承载覆盖价的占位行，不是一次成交。
 */
export async function upsertRenewalOverride(
  executor: PrismaExecutor,
  params: RenewalPriceOverrideWriteParams,
): Promise<void> {
  const { storeId, planId, overridePrice, fallbackConfigPrice } = params;

  await executor.storeMembershipLockedPrice.upsert({
    where: { storeId_planId: { storeId, planId } },
    create: {
      storeId,
      planId,
      price: fallbackConfigPrice,
      renewalPriceOverride: overridePrice,
      source: 'admin',
    },
    update: { renewalPriceOverride: overridePrice },
  });
}

/**
 * 在 `storeIds` 范围内列出「有子账号、但成交价快照里没有子账号加价」的门店。
 *
 * 先用「曾开通子账号」收窄再查快照：两张表都是**全平台**的，不带 `storeId in (...)`
 * 就是全表扫描后再到内存里求交集，管理端可见门店越多浪费越大。
 */
export async function findStoresPendingSubAccountBackfill(
  executor: PrismaExecutor,
  storeIds: number[],
): Promise<number[]> {
  if (storeIds.length === 0) {
    return [];
  }

  const scopedStoreIds = await findSubAccountFeatureStoreIds(
    executor,
    storeIds,
  );

  if (scopedStoreIds.length === 0) {
    return [];
  }

  return findPendingBackfillStoreIds(executor, scopedStoreIds);
}

/**
 * 在 `storeIds` 范围内列出「续费价**被调整过**」的门店，供管理端筛选复核。
 *
 * 口径是**曾经调过**，不是「当前还调着」：运营清空覆盖后 `renewalPriceOverride`
 * 会变回 null，但改价这件事发生过，门店仍要留在清单里。
 *
 * 因此判据落在审计表（一次实际变更一行，新建与清除都记），再并上「当前仍有覆盖价」
 * 兜底——审计若将来按保留期清理，当前生效的议价不能被顺带清出清单。
 */
export async function findStoresEverRenewalPriceAdjusted(
  executor: PrismaExecutor,
  storeIds: number[],
): Promise<number[]> {
  if (storeIds.length === 0) {
    return [];
  }

  const [auditedStoreIds, overrideStoreIds] = await Promise.all([
    findAuditedStoreIds(executor, storeIds),
    findStoreIdsWithOverride(executor, storeIds),
  ]);

  const adjustedStoreIds = new Set<number>([
    ...auditedStoreIds,
    ...overrideStoreIds,
  ]);

  // 按入参顺序返回，调用方的分页 / 排序口径不被打乱
  return storeIds.filter((storeId) => adjustedStoreIds.has(storeId));
}
