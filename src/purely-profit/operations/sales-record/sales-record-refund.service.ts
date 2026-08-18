import { Injectable } from '@nestjs/common';
import { FinanceCashFlowPayment, Prisma } from '@prisma/client';

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
        totalRevenue: true,
        totalProfit: true,
        paymentMethod: true,
        refund: { select: { id: true } },
      },
    });
    if (saleOrder.refund) return;

    const refund = await transaction.saleOrderRefund.create({
      data: {
        saleOrderId: saleOrder.id,
        storeId: saleOrder.storeId,
        amount: saleOrder.totalRevenue,
        profit: saleOrder.totalProfit,
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
        amount: saleOrder.totalRevenue,
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
