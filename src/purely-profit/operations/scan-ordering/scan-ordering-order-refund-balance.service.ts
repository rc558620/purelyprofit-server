import { ConflictException, Injectable } from '@nestjs/common';
import {
  ScanOrderCouponUsageStatus,
  ScanOrderFulfillmentStatus,
  ScanOrderPaymentAttemptStatus,
  ScanOrderPaymentStatus,
  ScanOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';

@Injectable()
export class ScanOrderingOrderRefundBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refundService: ScanOrderingRefundService,
  ) {}

  async refund(
    input: {
      orderId: number;
      storeId: number;
      version: number;
      reason: string;
    },
    operatorId: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const balancePayment = await tx.scanOrderBalanceTransaction.findUnique({
        where: {
          orderId_type: { orderId: input.orderId, type: 'payment' },
        },
        select: { customerId: true, amount: true },
      });
      if (!balancePayment)
        throw new ConflictException('未找到原余额支付记录，无法退款');
      const order = await tx.scanOrders.updateMany({
        where: {
          id: input.orderId,
          storeId: input.storeId,
          version: input.version,
          status: ScanOrderStatus.pending_acceptance,
          paymentStatus: ScanOrderPaymentStatus.paid,
        },
        data: {
          status: ScanOrderStatus.rejected,
          paymentStatus: ScanOrderPaymentStatus.refunded,
          fulfillmentStatus: ScanOrderFulfillmentStatus.closed,
          rejectReason: input.reason,
          version: { increment: 1 },
        },
      });
      if (order.count === 0)
        throw new ConflictException('订单状态已变化，请刷新后重试');
      await tx.marketingCustomer.update({
        where: { id: balancePayment.customerId },
        data: { balance: { increment: balancePayment.amount } },
      });
      await tx.scanOrderBalanceTransaction.create({
        data: {
          orderId: input.orderId,
          customerId: balancePayment.customerId,
          amount: balancePayment.amount,
          type: 'refund',
        },
      });
      const paymentAttempt = await tx.scanOrderPaymentAttempt.findFirst({
        where: {
          orderId: input.orderId,
          paymentChannel: 'marketing_balance',
          status: ScanOrderPaymentAttemptStatus.succeeded,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          merchantPaymentNo: true,
          providerTransactionId: true,
        },
      });
      await tx.scanOrderPaymentAttempt.updateMany({
        where: {
          orderId: input.orderId,
          paymentChannel: 'marketing_balance',
          status: ScanOrderPaymentAttemptStatus.succeeded,
        },
        data: { status: ScanOrderPaymentAttemptStatus.refunded },
      });
      await this.refundService.createRefundTaskInTransaction(tx, {
        orderId: input.orderId,
        storeId: input.storeId,
        paymentAttemptId: paymentAttempt?.id ?? null,
        triggerType: 'merchant_reject',
        refundAmount: balancePayment.amount,
        merchantPaymentNo: paymentAttempt?.merchantPaymentNo ?? null,
        providerTransactionId: paymentAttempt?.providerTransactionId ?? null,
        operatorType: 'merchant',
        operatorId,
        failureReason: `余额原路退款：${input.reason}`,
      });
      await this.refundService.markRefundTaskSucceededInTransaction(tx, {
        orderId: input.orderId,
      });
      await tx.scanOrderCouponUsage.updateMany({
        where: {
          orderId: input.orderId,
          status: {
            in: [
              ScanOrderCouponUsageStatus.locked,
              ScanOrderCouponUsageStatus.consumed,
            ],
          },
        },
        data: { status: ScanOrderCouponUsageStatus.refunded },
      });
      await tx.scanOrderStatusHistory.create({
        data: {
          orderId: input.orderId,
          storeId: input.storeId,
          fromStatus: ScanOrderStatus.pending_acceptance,
          toStatus: ScanOrderStatus.rejected,
          operatorType: 'merchant',
          operatorId,
          reason: `余额原路退款：${input.reason}`,
        },
      });
      return tx.scanOrders.findUniqueOrThrow({
        where: { id: input.orderId },
        select: {
          id: true,
          storeId: true,
          sessionId: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          refundTasks: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              refundSucceededAt: true,
              processedAt: true,
              triggeredAt: true,
            },
          },
        },
      });
    });
  }
}
