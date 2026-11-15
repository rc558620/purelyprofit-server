import type { Prisma } from '@prisma/client';
import { DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS } from '../../purely-profit/marketing/marketing.utils';
import { safeParsePointsRatio } from '../../purely-profit/marketing/schemas/member-level-settings.schema';
import {
  ClubPointsConfigCache,
  type ClubPointsRatioSource,
} from './club-order-points.cache';

// ─── 公共积分配置解析 ──────────────────────────────────────────────────

/** 可用于查询积分配置的 Prisma 客户端（PrismaService 或事务客户端） */
export type PointsConfigPrismaClient = Prisma.TransactionClient;

/** 模块级缓存实例：本文件是纯函数集合，没有 Nest DI 注入通道 */
const pointsConfigCache = new ClubPointsConfigCache();

/** 清空模块级缓存（仅单测需要，业务代码不应调用） */
export function clearClubPointsConfigCache(): void {
  pointsConfigCache.clear();
}

/** 积分配置读取选项 */
export interface PointsConfigFetchOptions {
  /**
   * 允许命中进程内短 TTL 缓存（5s）与在途去重。
   *
   * ⚠️ 仅展示 / 预览路径可开启（积分规则展示、订单价格预览）。
   * 创建订单与结算属于资金口径，必须保持默认直读，禁止传入本选项。
   */
  useCache?: boolean;
}

/** 积分抵扣配置（创建订单时使用） */
export interface ClubPointsRedeemConfig {
  redeemRatioPoints: number;
  maxRedeemRatio: number;
  enabled: boolean;
}

/** 积分获得配置（结算时使用） */
export interface ClubPointsEarnConfig {
  earnRatioCents: number;
  enabled: boolean;
}

/**
 * 从 marketingMemberLevelSetting.pointsRatio JSON 中解析积分抵扣配置
 * 统一提取到 utils，避免 creation / settlement 各自重复实现
 */
export function resolvePointsRedeemConfig(
  pointsRatio: unknown,
): ClubPointsRedeemConfig {
  const fallback = DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio;
  const parsed = safeParsePointsRatio(pointsRatio);

  if (parsed) {
    return {
      redeemRatioPoints: parsed.redeemRatioPoints,
      maxRedeemRatio: parsed.maxRedeemRatio,
      enabled: parsed.enabled,
    };
  }

  return {
    redeemRatioPoints: fallback.redeemRatioPoints,
    maxRedeemRatio: fallback.maxRedeemRatio,
    enabled: fallback.enabled,
  };
}

/**
 * 从 marketingMemberLevelSetting.pointsRatio JSON 中解析积分获得配置
 * 统一提取到 utils，避免 creation / settlement 各自重复实现
 */
export function resolvePointsEarnConfig(
  pointsRatio: unknown,
): ClubPointsEarnConfig {
  const fallback = DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio;
  const parsed = safeParsePointsRatio(pointsRatio);

  if (parsed) {
    return {
      earnRatioCents: parsed.earnRatioCents,
      enabled: parsed.enabled,
    };
  }

  return {
    earnRatioCents: fallback.earnRatioCents,
    enabled: fallback.enabled,
  };
}

/**
 * 查询门店积分抵扣配置（含活动覆盖逻辑）
 *
 * 从 marketingMemberLevelSetting 中读取配置，若 enabled=false 但存在
 * 活跃的 points_recharge 活动，则强制 enabled=true。
 * 供 preview / creation / member service 复用（BUG-7 DRY 提取）。
 *
 * ⚠️ 设计决策：返回的 enabled 字段仅用于：
 *   1. 后台管理页展示积分功能开关状态
 *   2. settlement 中「赚取积分」逻辑（awardConsumptionPoints）
 *   调用方（preview / creation）在「抵扣积分」时应忽略 enabled，
 *   只取 redeemRatioPoints / maxRedeemRatio 进行计算。
 */
export async function fetchPointsRedeemConfig(
  prisma: PointsConfigPrismaClient,
  storeId: number,
  options?: PointsConfigFetchOptions,
): Promise<ClubPointsRedeemConfig> {
  const source = await resolvePointsRatioSource(prisma, storeId, options);
  const config = resolvePointsRedeemConfig(source.pointsRatio);

  if (!config.enabled && source.hasPointsRechargePromo) {
    return { ...config, enabled: true };
  }

  return config;
}

/**
 * 查询门店积分获得配置（含活动覆盖逻辑）
 *
 * 与 fetchPointsRedeemConfig 对称，供 settlement service 复用。
 *
 * ⚠️ 设计决策区分「赚取」与「抵扣」：
 *   - enabled 控制「赚取积分」（settlement.awardConsumptionPoints），未启用时不赠送。
 *   - enabled 不控制「抵扣积分」（creation.calcPointsDeduction），用户有积分即可抵扣。
 *   禁止将 enabled 检查逻辑复制到抵扣路径。
 */
export async function fetchPointsEarnConfig(
  prisma: PointsConfigPrismaClient,
  storeId: number,
  options?: PointsConfigFetchOptions,
): Promise<ClubPointsEarnConfig> {
  const source = await resolvePointsRatioSource(prisma, storeId, options);
  const config = resolvePointsEarnConfig(source.pointsRatio);

  if (!config.enabled && source.hasPointsRechargePromo) {
    return { ...config, enabled: true };
  }

  return config;
}

/**
 * 回源读取门店积分配置：原始 `pointsRatio` JSON + 活动覆盖标记。
 *
 * 抵扣与获得共用同一行的同一个 `enabled`，因此活动覆盖判断只需一次；
 * 合并回源后两种口径不会各自再查一遍配置表。
 */
async function loadPointsRatioSource(
  prisma: PointsConfigPrismaClient,
  storeId: number,
): Promise<ClubPointsRatioSource> {
  const settings = await prisma.marketingMemberLevelSetting.findUnique({
    where: { storeId },
    select: { pointsRatio: true },
  });

  const pointsRatio = settings?.pointsRatio;
  // 配置本身已启用时无需再判活动覆盖，省掉一次活动表查询
  if (resolvePointsRedeemConfig(pointsRatio).enabled) {
    return { pointsRatio, hasPointsRechargePromo: false };
  }

  const now = new Date();
  const promo = await prisma.marketingPromotion.findFirst({
    where: {
      storeId,
      type: 'points_recharge',
      enabled: true,
      startAt: { lte: now },
      endAt: { gte: now },
    },
    select: { id: true },
  });
  return { pointsRatio, hasPointsRechargePromo: promo !== null };
}

/** 按调用方语义取配置来源：资金路径直读，展示路径允许命中短 TTL 缓存 */
async function resolvePointsRatioSource(
  prisma: PointsConfigPrismaClient,
  storeId: number,
  options?: PointsConfigFetchOptions,
): Promise<ClubPointsRatioSource> {
  if (options?.useCache !== true) {
    return loadPointsRatioSource(prisma, storeId);
  }

  return pointsConfigCache.remember(storeId, () =>
    loadPointsRatioSource(prisma, storeId),
  );
}

// ─── 积分抵扣计算（预览 / 创建 / 核销券通用）────────────────────────────

/** 积分为 0 的抵扣结果（早退常量，避免各处重复构造字面量） */
const ZERO_POINTS_DEDUCTION = { pointsDeductFen: 0, pointsUsed: 0 } as const;

/** 已持有可用积分时的抵扣计算参数 */
export interface ClubResolvePointsDeductionParams {
  storeId: number;
  /** 折后价（分） */
  priceAfterDiscountFen: number;
  usePoints: boolean;
  /** 调用方已读取的可用积分（顾客行不存在时传 0） */
  availablePoints: number;
  /**
   * 允许命中积分配置短 TTL 缓存。**仅价格预览可开启**；
   * 创建订单、结算与核销属于资金口径，必须保持默认（直读）。
   */
  useCachePointsConfig?: boolean;
}

/**
 * 积分抵扣计算（**可用积分已经由调用方读取**）。
 *
 * 与 {@link resolvePointsDeduction} 的区别：这里不查顾客行，只查积分配置。
 * 供那些「同一请求内已经读过顾客行」的调用方复用（如订单预览同时需要
 * points 与 balance，一次读取即可，禁止为两个字段各查一次同一行）。
 *
 * 早退语义与 `resolvePointsDeduction` 完全一致：未开启积分抵扣或折后价 ≤ 0 时
 * 既不查配置也不读顾客行。
 */
export async function resolvePointsDeductionFromAvailablePoints(
  prisma: PointsConfigPrismaClient,
  params: ClubResolvePointsDeductionParams,
): Promise<{ pointsDeductFen: number; pointsUsed: number }> {
  const {
    storeId,
    priceAfterDiscountFen,
    usePoints,
    availablePoints,
    useCachePointsConfig,
  } = params;

  if (!usePoints || priceAfterDiscountFen <= 0) {
    return { ...ZERO_POINTS_DEDUCTION };
  }

  // ⚠️ 注意：fetchPointsRedeemConfig 返回的 enabled 字段在此处被有意忽略，
  // 仅取 redeemRatioPoints / maxRedeemRatio 进行计算（见函数头 JSDoc 设计决策）。
  const pointsConfig = await fetchPointsRedeemConfig(prisma, storeId, {
    useCache: useCachePointsConfig === true,
  });

  return calcPointsRedeemDetail(
    priceAfterDiscountFen,
    pointsConfig,
    availablePoints,
  );
}

/**
 * 积分抵扣计算（含 DB 查询，preview / creation / voucher-context 共用）
 *
 * ════════════════════════════════════════════════════════════════
 *  ⚠️  项目设计决策（禁止修改）：
 *      积分抵扣不受 enabled 开关限制——即使 enabled=false，只要用户有积分
 *      且 redeemRatioPoints/maxRedeemRatio 配置正常，就允许抵扣。
 *      禁止在本函数中引入 !enabled 拦截逻辑。
 * ════════════════════════════════════════════════════════════════
 */
export async function resolvePointsDeduction(
  prisma: PointsConfigPrismaClient,
  storeId: number,
  customerId: number,
  priceAfterDiscountFen: number,
  usePoints: boolean,
): Promise<{ pointsDeductFen: number; pointsUsed: number }> {
  if (!usePoints || priceAfterDiscountFen <= 0) {
    return { ...ZERO_POINTS_DEDUCTION };
  }

  const customer = await prisma.marketingCustomer.findUnique({
    where: { id: customerId },
    select: { points: true },
  });

  return resolvePointsDeductionFromAvailablePoints(prisma, {
    storeId,
    priceAfterDiscountFen,
    usePoints,
    availablePoints: customer?.points ?? 0,
  });
}

/**
 * 积分抵扣金额计算（纯函数，无 DB 依赖）
 *
 * 统一 preview / creation 两个 service 的积分抵扣计算逻辑，
 * 消除重复代码（BUG-8 修复）。
 *
 * 整数算术（BUG-7 修复）：
 *   availableDeductFen = floor(availablePoints × 100 / redeemRatioPoints)
 *   pointsUsed = ceil(pointsDeductFen × redeemRatioPoints / 100)
 *   避免 100 / redeemRatioPoints 产生浮点中间值导致 IEEE 754 尾差。
 *
 * @param priceAfterDiscountFen 折后价（分）
 * @param redeemConfig          积分抵扣配置
 * @param availablePoints       用户当前可用积分
 */
export function calcPointsRedeemDetail(
  priceAfterDiscountFen: number,
  redeemConfig: ClubPointsRedeemConfig,
  availablePoints: number,
): { pointsDeductFen: number; pointsUsed: number } {
  if (redeemConfig.redeemRatioPoints <= 0 || redeemConfig.maxRedeemRatio <= 0) {
    return { pointsDeductFen: 0, pointsUsed: 0 };
  }

  if (availablePoints <= 0) {
    return { pointsDeductFen: 0, pointsUsed: 0 };
  }

  // 最多可抵扣金额（分）= 折后价 × 最大抵扣比例，向下取整到整分
  const maxDeductFen = Math.floor(
    priceAfterDiscountFen * redeemConfig.maxRedeemRatio,
  );

  // 整数算术：availablePoints × 100 ÷ redeemRatioPoints，避免浮点中间值
  const availableDeductFen = Math.floor(
    (availablePoints * 100) / redeemConfig.redeemRatioPoints,
  );

  const pointsDeductFen = Math.min(maxDeductFen, availableDeductFen);

  // 实际消耗积分 = 抵扣金额 × redeemRatioPoints ÷ 100，向上取整避免少扣
  const pointsUsed = Math.ceil(
    (pointsDeductFen * redeemConfig.redeemRatioPoints) / 100,
  );

  return { pointsDeductFen, pointsUsed };
}
