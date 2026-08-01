import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ScanOrderCouponUsageStatus,
  ScanOrderFulfillmentStatus,
  ScanOrderPaymentAttemptStatus,
  ScanOrderPaymentStatus,
  Prisma,
  ScanOrderStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';

/**
 * 商家扫码点餐订单退款处理服务。
 */
@Injectable()
export class ScanOrderingOrderRefundHandlingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly refundService: ScanOrderingRefundService,
    private readonly configService: ConfigService,
  ) {}

  async rejectOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权操作扫码点餐订单',
    );

    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, storeId },
      select: {
        id: true,
        paymentStatus: true,
        paidAmount: true,
        session: { select: { id: true } },
        paymentAttempts: {
          where: { status: 'succeeded' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            paymentChannel: true,
            merchantPaymentNo: true,
            providerTransactionId: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('扫码点餐订单不存在');

    if (order.paymentStatus === 'paid') {
      const attempt = order.paymentAttempts?.[0] ?? null;
      const isProduction =
        this.configService.get<string>('nodeEnv') === 'production';
      if (attempt?.paymentChannel === 'marketing_balance' || !isProduction) {
        await this.refundMarketingBalanceOrder(
          user,
          order.id,
          storeId,
          version,
          reason,
        );
        return;
      }
      await this.initiateRefundFlow(
        user,
        order.id,
        storeId,
        version,
        reason,
        order.paidAmount,
        attempt,
      );
      return;
    }

    await this.rejectUnpaidOrder(user, orderId, storeId, version, reason);
  }

  async completeRefund(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    providerRefundNo?: string,
    providerRefundId?: string,
  ): Promise<void> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权操作扫码点餐退款',
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.scanOrders.updateMany({
        where: {
          id: orderId,
          storeId,
          version,
          status: ScanOrderStatus.refunding,
          paymentStatus: ScanOrderPaymentStatus.refunding,
        },
        data: {
          status: ScanOrderStatus.rejected,
          paymentStatus: ScanOrderPaymentStatus.refunded,
          fulfillmentStatus: ScanOrderFulfillmentStatus.closed,
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        const existing = await tx.scanOrders.findFirst({
          where: { id: orderId, storeId },
          select: { id: true, status: true, paymentStatus: true },
        });

        if (!existing) throw new NotFoundException('扫码点餐订单不存在');
        if (
          existing.status === ScanOrderStatus.rejected &&
          existing.paymentStatus === ScanOrderPaymentStatus.refunded
        ) {
          throw new ConflictException('订单退款已完成，请勿重复操作');
        }

        throw new ConflictException('订单状态已变化，请刷新后重试');
      }

      await tx.scanOrderPaymentAttempt.updateMany({
        where: { orderId, status: ScanOrderPaymentAttemptStatus.succeeded },
        data: { status: ScanOrderPaymentAttemptStatus.refunded },
      });

      await tx.scanOrderCouponUsage.updateMany({
        where: {
          orderId,
          status: {
            in: [
              ScanOrderCouponUsageStatus.locked,
              ScanOrderCouponUsageStatus.consumed,
            ],
          },
        },
        data: { status: ScanOrderCouponUsageStatus.refunded },
      });

      await this.refundService.markRefundTaskSucceededInTransaction(tx, {
        orderId,
        providerRefundNo: providerRefundNo ?? null,
        providerRefundId: providerRefundId ?? null,
      });

      await tx.scanOrderStatusHistory.create({
        data: {
          orderId,
          storeId,
          fromStatus: ScanOrderStatus.refunding,
          toStatus: ScanOrderStatus.rejected,
          operatorType: 'merchant',
          operatorId: user.id,
          reason: '退款完成，订单已关闭',
        },
      });

      return tx.scanOrders.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          storeId: true,
          sessionId: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
        },
      });
    });

    if (updated) {
      this.realtimeService.publishOrderStatusChanged({
        orderId: updated.id,
        storeId: updated.storeId,
        sessionId: updated.sessionId,
        status: updated.status,
        paymentStatus: updated.paymentStatus,
        fulfillmentStatus: updated.fulfillmentStatus,
      });
    }
  }

  private async refundMarketingBalanceOrder(
    user: AuthenticatedUser,
    orderId: number,
    storeId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const balancePayment = await tx.scanOrderBalanceTransaction.findUnique({
        where: { orderId_type: { orderId, type: 'payment' } },
        select: { customerId: true, amount: true },
      });
      if (!balancePayment)
        throw new ConflictException('未找到原余额支付记录，无法退款');
      const order = await tx.scanOrders.updateMany({
        where: {
          id: orderId,
          storeId,
          version,
          status: 'pending_acceptance',
          paymentStatus: 'paid',
        },
        data: {
          status: 'rejected',
          paymentStatus: 'refunded',
          fulfillmentStatus: 'closed',
          rejectReason: reason,
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
          orderId,
          customerId: balancePayment.customerId,
          amount: balancePayment.amount,
          type: 'refund',
        },
      });
      const paymentAttempt = await tx.scanOrderPaymentAttempt.findFirst({
        where: {
          orderId,
          paymentChannel: 'marketing_balance',
          status: 'succeeded',
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
          orderId,
          paymentChannel: 'marketing_balance',
          status: 'succeeded',
        },
        data: { status: 'refunded' },
      });
      await this.refundService.createRefundTaskInTransaction(tx, {
        orderId,
        storeId,
        paymentAttemptId: paymentAttempt?.id ?? null,
        triggerType: 'merchant_reject',
        refundAmount: balancePayment.amount,
        merchantPaymentNo: paymentAttempt?.merchantPaymentNo ?? null,
        providerTransactionId: paymentAttempt?.providerTransactionId ?? null,
        operatorType: 'merchant',
        operatorId: user.id,
        failureReason: `余额原路退款：${reason}`,
      });
      await this.refundService.markRefundTaskSucceededInTransaction(tx, {
        orderId,
      });
      await tx.scanOrderCouponUsage.updateMany({
        where: {
          orderId,
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
          orderId,
          storeId,
          fromStatus: 'pending_acceptance',
          toStatus: 'rejected',
          operatorType: 'merchant',
          operatorId: user.id,
          reason: `余额原路退款：${reason}`,
        },
      });
      await this.archiveSessionWhenOrdersTerminal(tx, orderId, storeId);
      return tx.scanOrders.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          id: true,
          storeId: true,
          sessionId: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
        },
      });
    });
    this.realtimeService.publishOrderStatusChanged({
      orderId: updated.id,
      storeId: updated.storeId,
      sessionId: updated.sessionId,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
      fulfillmentStatus: updated.fulfillmentStatus,
    });
  }

  private async archiveSessionWhenOrdersTerminal(
    tx: Prisma.TransactionClient,
    orderId: number,
    storeId: number,
  ): Promise<void> {
    const order = await tx.scanOrders.findUnique({
      where: { id: orderId },
      select: { sessionId: true, session: { select: { tableId: true } } },
    });
    if (!order?.sessionId || !order.session?.tableId) return;
    const activeOrderCount = await tx.scanOrders.count({
      where: {
        sessionId: order.sessionId,
        deletedAt: null,
        status: {
          in: [
            'pending_payment',
            'pending_acceptance',
            'preparing',
            'served',
            'refunding',
          ],
        },
      },
    });
    if (activeOrderCount > 0) return;
    const now = new Date();
    const archived = await tx.scanOrderingSession.updateMany({
      where: { id: order.sessionId, storeId, status: 'active' },
      data: { status: 'checked_out', endedAt: now, archiveReason: 'cleared' },
    });
    if (archived.count === 0) return;
    await tx.scanOrderingCartItem.updateMany({
      where: { sessionId: order.sessionId, status: 'active' },
      data: { status: 'removed' },
    });
    const tableId = order.session.tableId;
    const otherActiveSessions = await tx.scanOrderingSession.count({
      where: {
        storeId,
        tableId,
        status: 'active',
        deletedAt: null,
      },
    });
    if (otherActiveSessions !== 0) return;
    await tx.scanOrderingTable.updateMany({
      where: {
        id: tableId,
        storeId,
        status: { not: 'disabled' },
      },
      data: { status: 'empty', version: { increment: 1 } },
    });
  }

  private async initiateRefundFlow(
    user: AuthenticatedUser,
    orderId: number,
    storeId: number,
    version: number,
    reason: string,
    paidAmount: number,
    paymentAttempt: {
      id: number | null;
      merchantPaymentNo: string | null;
      providerTransactionId: string | null;
    } | null,
  ): Promise<void> {
    const result = await this.prisma.scanOrders.updateMany({
      where: {
        id: orderId,
        storeId,
        version,
        status: ScanOrderStatus.pending_acceptance,
      },
      data: {
        status: ScanOrderStatus.refunding,
        paymentStatus: 'refunding',
        rejectReason: reason,
        version: { increment: 1 },
      },
    });

    if (result.count === 0)
      throw new ConflictException('订单状态已变化，请刷新后重试');

    await this.prisma.scanOrderStatusHistory.create({
      data: {
        orderId,
        storeId,
        fromStatus: ScanOrderStatus.pending_acceptance,
        toStatus: ScanOrderStatus.refunding,
        operatorType: 'merchant',
        reason,
      },
    });

    await this.refundService.createRefundTask({
      orderId,
      storeId,
      paymentAttemptId: paymentAttempt?.id ?? null,
      triggerType: 'merchant_reject',
      refundAmount: paidAmount,
      merchantPaymentNo: paymentAttempt?.merchantPaymentNo ?? null,
      providerTransactionId: paymentAttempt?.providerTransactionId ?? null,
      operatorType: 'merchant',
      operatorId: user.id,
      failureReason: `商家拒单：${reason}`,
    });

    const updatedOrder = await this.prisma.scanOrders.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        storeId: true,
        sessionId: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
      },
    });
    if (!updatedOrder) return;

    this.realtimeService.publishOrderStatusChanged({
      orderId: updatedOrder.id,
      storeId: updatedOrder.storeId,
      sessionId: updatedOrder.sessionId,
      status: updatedOrder.status,
      paymentStatus: updatedOrder.paymentStatus,
      fulfillmentStatus: updatedOrder.fulfillmentStatus,
    });
  }

  private async rejectUnpaidOrder(
    user: AuthenticatedUser,
    orderId: number,
    storeId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    const result = await this.prisma.scanOrders.updateMany({
      where: {
        id: orderId,
        storeId,
        version,
        status: ScanOrderStatus.pending_acceptance,
      },
      data: {
        status: ScanOrderStatus.rejected,
        fulfillmentStatus: ScanOrderFulfillmentStatus.closed,
        version: { increment: 1 },
        rejectReason: reason,
      },
    });

    if (result.count === 0)
      throw new ConflictException('订单状态已变化，请刷新后重试');

    await this.prisma.scanOrderStatusHistory.create({
      data: {
        orderId,
        storeId,
        fromStatus: ScanOrderStatus.pending_acceptance,
        toStatus: ScanOrderStatus.rejected,
        operatorType: 'merchant',
        reason,
      },
    });

    // ✅ 推送订单状态变更事件
    const order = await this.prisma.scanOrders.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        storeId: true,
        sessionId: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
      },
    });

    if (order) {
      this.realtimeService.publishOrderStatusChanged({
        orderId: order.id,
        storeId: order.storeId,
        sessionId: order.sessionId,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
      });
    }
  }
}
