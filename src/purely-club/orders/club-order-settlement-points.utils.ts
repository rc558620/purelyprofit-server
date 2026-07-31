import { BadRequestException, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { fetchPointsEarnConfig } from './club-order-points.utils';
import type {
  ClubOrderDraftPayload,
  ClubServiceOrderMetadata,
} from './club-order-drafts.types';

const logger = new Logger('ClubOrderSettlementPoints');

export interface ClubPointsSettlementContext {
  storeId: number;
  description: string;
  paidAmountFen: number;
}

// ─── 积分扣减 ─────────────────────────────────────────────────────────────

/**
 * 扣减顾客积分（结算时调用）
 *
 * BUG-6 修复：使用 updateMany + points >= pointsUsed 条件保证积分不会并发扣减为负数
 */
export async function deductCustomerPoints(
  tx: Prisma.TransactionClient,
  draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
  customerId: number,
  pointsUsed: number,
): Promise<void> {
  await deductPointsForSettlement(
    tx,
    {
      storeId: draft.storeId,
      description: draft.metadata.productName,
      paidAmountFen: draft.amountFen,
    },
    customerId,
    pointsUsed,
  );
}

export async function deductPointsForSettlement(
  tx: Prisma.TransactionClient,
  context: ClubPointsSettlementContext,
  customerId: number,
  pointsUsed: number,
): Promise<void> {
  if (pointsUsed <= 0) return;
  const result = await tx.marketingCustomer.updateMany({
    where: {
      id: customerId,
      points: { gte: pointsUsed },
    },
    data: {
      points: { decrement: pointsUsed },
    },
  });
  if (result.count === 0) {
    throw new BadRequestException(
      '积分不足或已被并发抵扣，当前积分无法完成扣减',
    );
  }

  // 记录积分扣减流水，与 awardConsumptionPoints 中的 earn 流水保持一致
  await tx.marketingPointsRecord.create({
    data: {
      storeId: context.storeId,
      customerId,
      amount: -pointsUsed,
      type: 'spend' as const,
      description: `消费抵扣积分（${context.description}）`,
    },
  });
}

// ─── 积分奖励 ─────────────────────────────────────────────────────────────

/**
 * 根据消费金额和积分规则增加积分
 * earnRatioCents 单位是"分"，表示消费多少分获得 1 积分
 * 前端通过 yuanStrToCents 将元转为分存储，例如消费 200 元得 1 积分 → earnRatioCents=20000
 * 积分 = floor(实际支付金额（分）/ earnRatioCents)
 *
 * ⚠️ 设计决策区分「赚取积分」与「抵扣积分」：
 *    - 赚取积分（本方法）：受 enabled 开关控制，enabled=false 时不赠送积分。这是正确的。
 *    - 抵扣积分（calcPointsDeduction）：不受 enabled 开关控制，用户有积分即可抵扣。
 *    禁止将本方法的 enabled 检查逻辑复制到 calcPointsDeduction。
 */
export async function awardConsumptionPoints(
  tx: Prisma.TransactionClient,
  draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
  customerId: number,
): Promise<number> {
  return awardPointsForSettlement(
    tx,
    {
      storeId: draft.storeId,
      description: draft.metadata.productName,
      paidAmountFen: draft.amountFen,
    },
    customerId,
  );
}

export async function awardPointsForSettlement(
  tx: Prisma.TransactionClient,
  context: ClubPointsSettlementContext,
  customerId: number,
): Promise<number> {
  // 获取积分规则配置
  const pointsRatioConfig = await fetchPointsEarnConfig(tx, context.storeId);

  // 若积分规则未启用，不增加积分
  if (!pointsRatioConfig.enabled) {
    logger.warn(`积分规则未启用，storeId=${context.storeId}`);
    return 0;
  }

  // 按实际支付金额计算消费积分
  // earnRatioCents 实际存储的是"元"单位（与 earnRatioYuan 相同），需乘 100 转为"分"
  // 积分 = floor(实际支付金额（分）/ (earnRatioCents × 100))
  let earnedPoints = Math.floor(
    context.paidAmountFen / (pointsRatioConfig.earnRatioCents * 100),
  );

  // 查询是否有生效的 points_2x（双倍积分）活动，若有则将积分翻倍
  const pointsMultiplier = await resolvePointsMultiplier(tx, context.storeId);
  if (pointsMultiplier > 1 && earnedPoints > 0) {
    const bonusPoints = earnedPoints * (pointsMultiplier - 1);
    earnedPoints += bonusPoints;
    logger.log(
      `双倍积分活动生效: 基础积分=${earnedPoints - bonusPoints}, 加倍=${bonusPoints}, 合计=${earnedPoints}`,
    );
  }

  logger.log(
    `计算积分: 实际支付=${context.paidAmountFen}分, earnRatioCents=${pointsRatioConfig.earnRatioCents}, 获得=${earnedPoints}积分`,
  );

  if (earnedPoints <= 0) {
    logger.warn(`计算的积分 <= 0，不增加，customerId=${customerId}`);
    return 0;
  }

  // 增加顾客积分
  await tx.marketingCustomer.update({
    where: { id: customerId },
    data: {
      points: { increment: earnedPoints },
    },
  });

  logger.log(`成功增加积分 ${earnedPoints}，customerId=${customerId}`);

  // 记录积分增加流水（与 deductCustomerPoints 中 spend 流水保持一致）
  // 在同一事务内：若 create 失败则整体回滚，保证积分余额与流水记录一致
  await tx.marketingPointsRecord.create({
    data: {
      storeId: context.storeId,
      customerId,
      amount: earnedPoints,
      type: 'earn' as const,
      description:
        pointsMultiplier > 1
          ? '消费获得积分（含双倍积分加成）'
          : '消费获得积分',
    },
  });
  return earnedPoints;
}

// ─── 积分倍数查询 ──────────────────────────────────────────────────────────

/**
 * 查询门店是否有生效的 points_2x 活动，返回积分倍数（2 或 1）
 */
export async function resolvePointsMultiplier(
  tx: Prisma.TransactionClient,
  storeId: number,
): Promise<number> {
  const now = new Date();
  const activePoints2x = await tx.marketingPromotion.findFirst({
    where: {
      storeId,
      type: 'points_2x',
      enabled: true,
      startAt: { lte: now },
      endAt: { gte: now },
    },
    select: { id: true },
  });

  return activePoints2x ? 2 : 1;
}
