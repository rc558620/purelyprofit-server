// 购卡余额支付结算：储值余额扣款 + 消费流水 + 顾客指标（累计消费/到店次数/等级）
// 与团购券 / 服务订单余额结算同口径：余额支付即门店消费，必须留下可核对的消费流水，
// 否则余额减少在商家端无任何痕迹。购卡本身不赠送消费积分（与微信支付购卡口径一致），
// 避免「同一张卡换个支付方式积分不同」的口径分裂。
import { BadRequestException, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { debitCustomerBalance } from '../payments/club-balance-settlement.utils';
import {
  CLUB_CARD_CUSTOMER_NOT_FOUND_MESSAGE,
  CLUB_CARD_ORDER_TITLE_SUFFIX,
  buildCardBalanceInsufficientMessage,
} from './club-cards.constants';

const logger = new Logger('ClubCardBalanceSettlement');

/** 余额结算所需的最小订单投影（避免依赖 Prisma 全量类型） */
export interface CardBalanceSettlementOrder {
  id: number;
  orderNo: string;
  storeId: number;
  /** 应付金额（分）：余额支付全额从储值扣款 */
  amount: number;
  planNameSnapshot: string;
}

/**
 * 余额支付结算（事务内执行）：扣余额 → 记消费流水 → 更新顾客指标。
 *
 * 必须在落账事务内调用：扣款成功而发卡失败会留下「钱扣了没有卡」的资金事故，
 * 因此由调用方（ClubCardSettlementService）保证两者同事务提交或一起回滚。
 */
export async function settleCardBalancePayment(
  tx: Prisma.TransactionClient,
  order: CardBalanceSettlementOrder,
  customerId: number,
): Promise<void> {
  const customer = await tx.marketingCustomer.findFirst({
    where: { id: customerId, storeId: order.storeId, deletedAt: null },
    select: { id: true, totalSpent: true, balance: true },
  });
  if (!customer) {
    throw new BadRequestException(CLUB_CARD_CUSTOMER_NOT_FOUND_MESSAGE);
  }

  const balancePaidFen = order.amount;
  if (customer.balance < balancePaidFen) {
    throw new BadRequestException(
      buildCardBalanceInsufficientMessage(customer.balance, balancePaidFen),
    );
  }

  // 消费流水：购卡无积分抵扣，amount 与 balancePaid 同口径
  await tx.marketingConsumption.create({
    data: {
      storeId: order.storeId,
      customerId,
      amount: balancePaidFen,
      balancePaid: balancePaidFen,
      pointsDeducted: 0,
      actualPointsDeducted: 0,
      payType: 'balance',
      itemsSummary: `${order.planNameSnapshot}${CLUB_CARD_ORDER_TITLE_SUFFIX}`,
      promotionId: null,
    },
  });

  // 购卡无积分抵扣：累计消费口径与消费流水 amount 一致，否则物化字段会永远小于流水聚合
  await debitCustomerBalance(tx, {
    customerId,
    storeId: order.storeId,
    balancePaidFen,
    metrics: {
      settlementAmountFen: balancePaidFen,
      currentTotalSpent: customer.totalSpent,
    },
  });

  logger.log(
    `购卡余额支付结算: orderNo=${order.orderNo}, customerId=${customerId}, 扣款=${balancePaidFen}分`,
  );
}
