// 团购券余额支付结算：储值余额扣款 + 消费流水 + 顾客指标（累计消费/到店次数/等级）+ 赠送消费积分
// 与「服务订单余额结算」同口径：余额支付即门店消费，需记流水与累计消费
import { BadRequestException, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { calcCustomerTier } from '../../purely-profit/marketing/marketing.utils';
import { queryCustomerTierThresholds } from '../../purely-profit/marketing/marketing.query';
import { Money } from '../../shared/money.utils';
import { awardPointsForSettlement } from '../orders/club-order-settlement-points.utils';
import type { VoucherBalanceSettlementOrder } from './club-voucher-order-payment.types';
import { CLUB_VOUCHER_CUSTOMER_NOT_FOUND_MESSAGE } from './club-voucher-orders.constants';

const logger = new Logger('ClubVoucherOrderBalanceSettlement');

/** 余额支付结算（事务内执行）：扣余额 → 记流水 → 更新顾客指标 → 赠送消费积分 */
export async function settleVoucherBalancePayment(
  tx: Prisma.TransactionClient,
  order: VoucherBalanceSettlementOrder,
  customerId: number,
): Promise<void> {
  const customer = await tx.marketingCustomer.findFirst({
    where: { id: customerId, storeId: order.storeId, deletedAt: null },
    select: { id: true, totalSpent: true, balance: true },
  });
  if (!customer) {
    throw new BadRequestException(CLUB_VOUCHER_CUSTOMER_NOT_FOUND_MESSAGE);
  }

  // 余额扣减金额 = 订单实付金额（积分抵扣部分不占余额）
  const balancePaidFen = order.paidAmountFen;
  if (customer.balance < balancePaidFen) {
    throw new BadRequestException(
      `余额不足，当前余额 ¥${Money.fromDbCents(customer.balance).toFixedOutputYuan()}，需支付 ¥${Money.fromDbCents(balancePaidFen).toFixedOutputYuan()}`,
    );
  }

  // 消费流水：amount 含积分抵扣部分，反映消费总金额
  await tx.marketingConsumption.create({
    data: {
      storeId: order.storeId,
      customerId,
      amount: balancePaidFen + order.pointsDeductFen,
      balancePaid: balancePaidFen,
      pointsDeducted: order.pointsDeductFen,
      // 积分侧事实源：与 pointsDeducted（金额分）配合可独立核对抵扣比例
      actualPointsDeducted: order.pointsUsed,
      payType: 'balance',
      itemsSummary: order.productName,
      promotionId: null,
    },
  });

  // updateMany + where 条件保证余额不会被并发扣减为负数
  const newTotalSpent = customer.totalSpent + balancePaidFen;
  // 与 B 端手动消费同源：读门店会员等级设置的可配置阈值，不能用硬编码兜底值
  const thresholds = await queryCustomerTierThresholds(tx, order.storeId);
  const updated = await tx.marketingCustomer.updateMany({
    where: { id: customerId, balance: { gte: balancePaidFen } },
    data: {
      balance: { decrement: balancePaidFen },
      totalSpent: { increment: balancePaidFen },
      visitCount: { increment: 1 },
      lastVisitAt: new Date(),
      tier: calcCustomerTier(newTotalSpent, thresholds) as never,
    },
  });
  if (updated.count !== 1) {
    throw new BadRequestException(
      `余额不足或已被并发消费，当前余额无法支付 ¥${Money.fromDbCents(balancePaidFen).toFixedOutputYuan()}`,
    );
  }

  // 赠送消费积分（受积分规则 enabled 开关控制）
  await awardPointsForSettlement(
    tx,
    {
      storeId: order.storeId,
      description: order.productName,
      paidAmountFen: order.paidAmountFen,
    },
    customerId,
  );

  logger.log(
    `团购券余额支付结算: orderNo=${order.orderNo}, customerId=${customerId}, 扣款=${balancePaidFen}分`,
  );
}
