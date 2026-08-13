import type { Prisma } from '@prisma/client';
import { DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS } from '../../purely-profit/marketing/marketing.utils';
import { safeParsePointsRatio } from '../../purely-profit/marketing/schemas/member-level-settings.schema';

// ─── 公共积分配置解析 ──────────────────────────────────────────────────

/** 可用于查询积分配置的 Prisma 客户端（PrismaService 或事务客户端） */
export type PointsConfigPrismaClient = Prisma.TransactionClient;

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
): Promise<ClubPointsRedeemConfig> {
  const settings = await prisma.marketingMemberLevelSetting.findUnique({
    where: { storeId },
    select: { pointsRatio: true },
  });

  const config = resolvePointsRedeemConfig(settings?.pointsRatio);

  if (!config.enabled) {
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
    if (promo) {
      return { ...config, enabled: true };
    }
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
): Promise<ClubPointsEarnConfig> {
  const settings = await prisma.marketingMemberLevelSetting.findUnique({
    where: { storeId },
    select: { pointsRatio: true },
  });

  const config = resolvePointsEarnConfig(settings?.pointsRatio);

  if (!config.enabled) {
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
    if (promo) {
      return { ...config, enabled: true };
    }
  }

  return config;
}

// ─── 积分抵扣计算（预览 / 创建 / 核销券通用）────────────────────────────

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
    return { pointsDeductFen: 0, pointsUsed: 0 };
  }

  // ⚠️ 注意：fetchPointsRedeemConfig 返回的 enabled 字段在此处被有意忽略，
  // 仅取 redeemRatioPoints / maxRedeemRatio 进行计算（见函数头 JSDoc 设计决策）。
  const pointsConfig = await fetchPointsRedeemConfig(prisma, storeId);

  const customer = await prisma.marketingCustomer.findUnique({
    where: { id: customerId },
    select: { points: true },
  });

  const availablePoints = customer?.points ?? 0;

  return calcPointsRedeemDetail(
    priceAfterDiscountFen,
    pointsConfig,
    availablePoints,
  );
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
