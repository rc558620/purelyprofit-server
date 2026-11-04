// 团购券退款回补：积分退回 + 库存回补 + 储值余额退回（退款与商家拒绝共用）
//
// 从 ClubVoucherOrderRefundService 抽出的原因：这三步是「把结算时的账反向冲回来」，
// 与「谁有资格退款 / 什么时候发起微信退款」是两件事；抽成无状态函数后，
// 两条退款链路必须走同一份回补逻辑，避免一处改了另一处漏改。
import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { calcCustomerTier } from '../../purely-profit/marketing/marketing.utils';
import { queryCustomerTierThresholds } from '../../purely-profit/marketing/marketing.query';

const logger = new Logger('ClubVoucherOrderRefundRestore');

/** 退款/拒绝回补所需订单字段（结构上兼容 Prisma 的订单行） */
export interface RefundRestoreOrder {
  id: number;
  /** 业务订单号（异常留痕用） */
  orderNo: string;
  storeId: number;
  customerId: number | null;
  productId: number;
  productName: string;
  pointsUsed: number;
  quantity: number;
  /** 实付金额（分）；余额支付退款时原路退回该金额 */
  paidAmountFen: number;
  /** 结算时积分抵扣的金额（分）——消费流水 amount 含该部分，冲减时必须同口径 */
  pointsDeductFen: number;
  /** 结算时赠送的积分个数快照（退款时按此回收） */
  pointsAwarded: number;
}

/** 积分退回 + 库存回补（退款与商家拒绝共用，保证两侧链路一致） */
export async function restorePointsAndStock(
  tx: Prisma.TransactionClient,
  order: RefundRestoreOrder,
): Promise<void> {
  // 积分退回：实际扣减的积分回补到顾客积分账户，并记录流水（与扣减时 spend 流水对称，保证可审计）
  if (order.pointsUsed > 0 && order.customerId !== null) {
    await tx.marketingCustomer.update({
      where: { id: order.customerId },
      data: { points: { increment: order.pointsUsed } },
    });
    await tx.marketingPointsRecord.create({
      data: {
        storeId: order.storeId,
        customerId: order.customerId,
        amount: order.pointsUsed,
        type: 'earn' as const,
        description: `团购券退款返还积分（${order.productName}）`,
      },
    });
  }
  // 库存回补
  await tx.marketingProduct.update({
    where: { id: order.productId },
    data: { stock: { increment: order.quantity } },
  });
}

/**
 * 余额退回：储值余额回补 + 累计消费/到店次数回退 + 回收结算时赠送的积分 + 等级重算，
 * 与 settleVoucherBalancePayment 完全对称。
 *
 * 说明：lastVisitAt 不回退。它是「最近一次消费发生的时间」这一既成事实记录，
 * 而 totalSpent / visitCount / 积分属于账目额度，取消消费后必须账面回滚。
 */
export async function restoreVoucherBalance(
  tx: Prisma.TransactionClient,
  order: RefundRestoreOrder,
): Promise<void> {
  if (order.customerId === null || order.paidAmountFen <= 0) return;

  const customer = await tx.marketingCustomer.findFirst({
    where: { id: order.customerId, storeId: order.storeId, deletedAt: null },
    select: { id: true, totalSpent: true, visitCount: true, points: true },
  });
  if (!customer) return;

  // 回收结算时赠送的积分（与 awardPointsForSettlement 对称）。
  // 顾客可能已把赠送的积分花掉，此时按「现有积分」为上限回收，绝不扣成负数，差额留痕跟进。
  if (order.pointsAwarded > 0) {
    const refundablePoints = Math.min(order.pointsAwarded, customer.points);
    if (refundablePoints > 0) {
      const deducted = await tx.marketingCustomer.updateMany({
        where: { id: customer.id, points: { gte: refundablePoints } },
        data: { points: { decrement: refundablePoints } },
      });
      if (deducted.count === 1) {
        await tx.marketingPointsRecord.create({
          data: {
            storeId: order.storeId,
            customerId: customer.id,
            amount: -refundablePoints,
            type: 'spend' as const,
            description: `团购券退款回收赠送积分（${order.productName}）`,
          },
        });
      }
    }
    if (refundablePoints < order.pointsAwarded) {
      logger.error(
        `团购券退款赠送积分未能足额回收（顾客积分已被使用），请人工核对: ` +
          `orderNo=${order.orderNo}, customerId=${customer.id}, 应回收=${order.pointsAwarded}, 实回收=${refundablePoints}`,
      );
    }
  }

  // 累计消费的回滚金额必须与消费流水 amount 同口径（含积分抵扣部分）。
  // 流水本身不冲减：marketing_consumptions 有 amount >= 0 的库级约束，
  // 且它是消费发生时的审计事实；展示侧的退款冲减由退款单据承担
  // （见 computeCustomerConsumptionStats）。
  const refundAmountFen = order.paidAmountFen + order.pointsDeductFen;

  // totalSpent / visitCount 用绝对赋值避免历史数据异常导致负数；
  // visitCount 与结算时 increment: 1 对称回退——本笔消费既已取消，累计次数必须回滚，
  // 否则会与已回退的 totalSpent 形成账实偏差（次数虚高、等级门槛失真）。
  const newTotalSpent = Math.max(customer.totalSpent - refundAmountFen, 0);
  const newVisitCount = Math.max(customer.visitCount - 1, 0);
  // 与消费落账同源：读门店会员等级设置的可配置阈值
  const thresholds = await queryCustomerTierThresholds(tx, order.storeId);
  await tx.marketingCustomer.update({
    where: { id: customer.id },
    data: {
      balance: { increment: order.paidAmountFen },
      totalSpent: newTotalSpent,
      visitCount: newVisitCount,
      tier: calcCustomerTier(newTotalSpent, thresholds) as never,
    },
  });
}
