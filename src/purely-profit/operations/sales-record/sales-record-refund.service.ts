import { Injectable } from '@nestjs/common';
import { FinanceCashFlowPayment, Prisma } from '@prisma/client';
import {
  sumNetPayableCents,
  sumNetProfitCents,
} from '../../commerce/commerce.utils';

export interface RefundSalesRecordInput {
  saleOrderId: number;
  refundedAt: Date;
}

@Injectable()
export class SalesRecordRefundService {
  async refundInTransaction(
    transaction: Prisma.TransactionClient,
    input: RefundSalesRecordInput,
  ): Promise<void> {
    const saleOrder = await transaction.saleOrder.findUniqueOrThrow({
      where: { id: input.saleOrderId },
      select: {
        id: true,
        storeId: true,
        paymentMethod: true,
        refund: { select: { id: true } },
        items: {
          select: {
            productName: true,
            salePrice: true,
            profit: true,
            quantity: true,
          },
        },
      },
    });
    if (saleOrder.refund) return;

    // 退款金额必须是「客人实付净额」而不是营业额：
    // sale_orders.total_revenue 是营业额口径（纯消费券单已把券面计入），
    // 直接拿它退款会把 purelyClub 已付的券款从门店现金里退出去（多退一笔）。
    // 无抵扣行的订单（扫码点餐 / 手工录单）净额与营业额同值，行为不变。
    const refundAmount = sumNetPayableCents(saleOrder.items);
    const refundProfit = sumNetProfitCents(saleOrder.items);

    const refund = await transaction.saleOrderRefund.create({
      data: {
        saleOrderId: saleOrder.id,
        storeId: saleOrder.storeId,
        amount: refundAmount,
        profit: refundProfit,
        paymentMethod: saleOrder.paymentMethod,
        refundedAt: input.refundedAt,
      },
      select: { id: true },
    });
    await transaction.financeCashFlowRecord.create({
      data: {
        storeId: saleOrder.storeId,
        saleOrderRefundId: refund.id,
        direction: 'expense',
        category: 'refund',
        title: `销售单 ${saleOrder.id} 退款`,
        amount: refundAmount,
        payment: this.toCashFlowPayment(saleOrder.paymentMethod),
        note: '标准销售退款冲销',
        date: input.refundedAt,
      },
    });
  }

  private toCashFlowPayment(
    paymentMethod:
      | 'cash'
      | 'wechat'
      | 'alipay'
      | 'card'
      | 'other'
      | 'groupon_voucher'
      | 'platform',
  ): FinanceCashFlowPayment {
    // 团购券不在 FinanceCashFlowPayment 枚举内，退款冲销归入 other；
    // platform 平台结算退款冲销直接对应同名枚举。
    return paymentMethod === 'groupon_voucher'
      ? FinanceCashFlowPayment.other
      : paymentMethod;
  }
}
