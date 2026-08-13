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
import { ScanOrderingRefundStockRestoreService } from './scan-ordering-refund-stock-restore.service';

@Injectable()
export class ScanOrderingOrderRefundBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refundService: ScanOrderingRefundService,
    private readonly stockRestoreService: ScanOrderingRefundStockRestoreService,
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
      await this.stockRestoreService.restoreReservedStock(tx, input.orderId);
      await this.stockRestoreService.refundSaleOrder(tx, input.orderId);
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
      // BUG 修复：余额支付时已扣减积分（pointsSettlementStatus=settled），退款时原路返还并记录流水，
      // 未结算积分的订单（如开发态微信确认）不返还，避免凭空多积分
      const refundOrder = await tx.scanOrders.findUnique({
        where: { id: input.orderId },
        select: { marketingSnapshot: true },
      });
      const pointsSnapshot = (refundOrder?.marketingSnapshot ?? {}) as {
        pointsUsed?: number;
        pointsSettlementStatus?: string;
        earnedPoints?: number;
      };
      const refundPoints = pointsSnapshot.pointsUsed ?? 0;
      const earnedPoints = pointsSnapshot.earnedPoints ?? 0;
      const shouldRefundPoints =
        pointsSnapshot.pointsSettlementStatus === 'settled' && refundPoints > 0;
      if (shouldRefundPoints) {
        await tx.marketingCustomer.update({
          where: { id: balancePayment.customerId },
          data: { points: { increment: refundPoints } },
        });
        await tx.marketingPointsRecord.create({
          data: {
            storeId: input.storeId,
            customerId: balancePayment.customerId,
            amount: refundPoints,
            type: 'earn' as const,
            description: `扫码点餐退款返还积分（订单 ${input.orderId}）`,
          },
        });
      }
      // BUG 修复：下单时赠送的消费积分（earnedPoints）退款时一并回收，否则退款后积分净增赠送部分；
      // 仅回收不超过当前可用积分的部分，避免扣成负数（赠送积分可能已被用户消费）
      if (
        pointsSnapshot.pointsSettlementStatus === 'settled' &&
        earnedPoints > 0
      ) {
        const pointsCustomer = await tx.marketingCustomer.findUnique({
          where: { id: balancePayment.customerId },
          select: { points: true },
        });
        const revokePoints = Math.min(
          earnedPoints,
          pointsCustomer?.points ?? 0,
        );
        if (revokePoints > 0) {
          await tx.marketingCustomer.update({
            where: { id: balancePayment.customerId },
            data: { points: { decrement: revokePoints } },
          });
          await tx.marketingPointsRecord.create({
            data: {
              storeId: input.storeId,
              customerId: balancePayment.customerId,
              amount: -revokePoints,
              type: 'spend' as const,
              description: `扫码点餐退款回收消费赠送积分（订单 ${input.orderId}）`,
            },
          });
        }
      }
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
      // 同步标记退款任务的积分返还状态（schema.pointsRefundStatus 落地生效）
      if (shouldRefundPoints) {
        await tx.scanOrderRefundTask.updateMany({
          where: {
            orderId: input.orderId,
            status: { in: ['pending', 'refunding', 'manual_pending'] },
          },
          data: { pointsRefundStatus: 'succeeded' },
        });
      }
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
          pickupNumber: true,
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
