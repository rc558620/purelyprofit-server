import type { ClubPointsRedeemConfig } from './club-order-drafts.utils';

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
