import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ClubPaymentCallbackResult,
  ClubPaymentCallbackSettlementParams,
} from '../payments/club-payments.types';
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import { Prisma, ScanOrderPaymentAttemptStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ScanOrderingRefundService } from './scan-ordering-refund.service';
import { ScanOrderingSaleOrderBridgeService } from './scan-ordering-sale-order-bridge.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';

/**
 * 异常支付处理结果。
 *
 * 当已关闭订单收到支付成功回调时，事务正常提交后返回此结果，
 * 外部根据微信回调协议返回成功确认，避免微信持续重试。
 */
interface AnomalousPaymentResult {
  anomalous: true;
  orderId: number;
}

@Injectable()
export class ClubScanOrderingPaymentService {
  private readonly logger = new Logger(ClubScanOrderingPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentLockService: ClubPaymentLockService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly refundService: ScanOrderingRefundService,
    private readonly saleOrderBridgeService: ScanOrderingSaleOrderBridgeService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
  ) {}

  async confirmOrderPaidByCallback(
    merchantPaymentNo: string,
    params: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubPaymentCallbackResult> {
    const attempt = await this.prisma.scanOrderPaymentAttempt.findUnique({
      where: { merchantPaymentNo },
      select: { id: true, orderId: true, amount: true, status: true },
    });
    if (!attempt) throw new NotFoundException('扫码点餐支付流水不存在');
    if (attempt.amount !== params.amountFen) {
      throw new ConflictException('微信支付金额与扫码点餐订单不一致');
    }
    const result = await this.paymentLockService.withOrderLock(
      `scan-order:${attempt.orderId}`,
      async (): Promise<ClubPaymentCallbackResult | AnomalousPaymentResult> => {
        return this.prisma.$transaction(async (tx) => {
          const paymentAttempt = await tx.scanOrderPaymentAttempt.findUnique({
            where: { id: attempt.id },
          });
          const order = await tx.scanOrders.findUnique({
            where: { id: attempt.orderId },
          });
          if (!paymentAttempt || !order) {
            throw new NotFoundException('扫码点餐订单或支付流水不存在');
          }
          if (
            paymentAttempt.amount !== params.amountFen ||
            order.payableAmount !== params.amountFen
          ) {
            throw new ConflictException('微信支付金额与扫码点餐订单不一致');
          }
          // 幂等：已成功回调过
          if (
            paymentAttempt.status === ScanOrderPaymentAttemptStatus.succeeded &&
            order.paymentStatus === 'paid'
          ) {
            return {
              orderNo: order.orderNo,
              orderType: 'scan_ordering',
              status: 'pending_acceptance',
            };
          }
          // 订单已关闭（用户取消或支付超时）— 异常支付处理
          // 事务正常提交，不抛异常，退款任务和日志会持久化
          if (order.status === 'cancelled') {
            await this.handleAnomalousPayment(tx, {
              orderId: order.id,
              storeId: order.storeId,
              paymentAttemptId: paymentAttempt.id,
              merchantPaymentNo,
              providerTransactionId: params.transactionId,
              refundAmount: params.amountFen,
              cancelReason: order.cancelReason ?? '未知',
            });
            // 事务正常提交后返回异常支付结果
            return {
              anomalous: true,
              orderId: order.id,
            } satisfies AnomalousPaymentResult;
          }
          if (
            order.status !== 'pending_payment' ||
            order.paymentStatus !== 'unpaid'
          ) {
            throw new ConflictException('扫码点餐订单状态不允许确认支付');
          }
          await tx.scanOrderPaymentAttempt.update({
            where: { id: paymentAttempt.id },
            data: {
              status: ScanOrderPaymentAttemptStatus.succeeded,
              providerTransactionId: params.transactionId,
              paidAt: new Date(params.paidAtMs),
            },
          });
          await tx.scanOrders.update({
            where: { id: order.id },
            data: {
              status: 'pending_acceptance',
              paymentStatus: 'paid',
              paidAmount: params.amountFen,
              paidAt: new Date(params.paidAtMs),
              version: { increment: 1 },
            },
          });
          // 支付成功分配取餐号（幂等：已分配时直接跳过）
          await this.pickupNumberService.assignForPaidOrder(
            tx,
            order.id,
            order.storeId,
            params.paidAtMs,
          );
          await tx.scanOrderStatusHistory.create({
            data: {
              orderId: order.id,
              storeId: order.storeId,
              fromStatus: 'pending_payment',
              toStatus: 'pending_acceptance',
              operatorType: 'payment_callback',
              reason: `微信支付成功: ${params.transactionId}`,
            },
          });
          // 销售记录不在支付成功时创建：交班页须在商家出餐/拒绝后再展示订单
          return {
            orderNo: order.orderNo,
            orderType: 'scan_ordering',
            status: 'pending_acceptance',
          };
        });
      },
    );

    // 异常支付：事务已正常提交，退款任务已持久化
    // 按微信回调协议返回成功确认，避免微信持续重试
    if ('anomalous' in result) {
      const order = await this.prisma.scanOrders.findUnique({
        where: { id: result.orderId },
        select: { orderNo: true },
      });
      return {
        orderNo: order?.orderNo ?? '',
        orderType: 'scan_ordering',
        status: 'pending_acceptance',
      };
    }

    // 正常支付成功：推送实时事件
    const order = await this.prisma.scanOrders.findUnique({
      where: { id: attempt.orderId },
      select: {
        id: true,
        storeId: true,
        sessionId: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        pickupNumber: true,
        pickupBusinessDate: true,
        pickupNumberStatus: true,
        pickupCalledAt: true,
        pickupCompletedAt: true,
      },
    });
    if (order)
      this.realtimeService.publishOrderStatusChanged({
        orderId: order.id,
        storeId: order.storeId,
        sessionId: order.sessionId,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        pickupNumber: order.pickupNumber,
        pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
          order.pickupNumber,
        ),
        pickupNumberStatus: order.pickupNumberStatus,
        pickupCalledAt: order.pickupCalledAt?.toISOString() ?? null,
        pickupCompletedAt: order.pickupCompletedAt?.toISOString() ?? null,
      });
    return result;
  }

  /**
   * 处理异常支付：已关闭订单收到支付成功回调。
   *
   * 策略：
   * - 不恢复订单为已支付；
   * - 不重新扣减库存；
   * - 在支付尝试上记录回调数据；
   * - 创建退款任务（manual_pending），进入人工退款待办；
   * - 写入状态历史记录异常事件；
   * - 事务正常提交，不抛异常，保证退款任务持久化。
   */
  private async handleAnomalousPayment(
    tx: import('@prisma/client').Prisma.TransactionClient,
    params: {
      orderId: number;
      storeId: number;
      paymentAttemptId: number;
      merchantPaymentNo: string;
      providerTransactionId: string;
      refundAmount: number;
      cancelReason: string;
    },
  ): Promise<void> {
    // 记录回调数据到支付尝试
    await tx.scanOrderPaymentAttempt.update({
      where: { id: params.paymentAttemptId },
      data: {
        status: ScanOrderPaymentAttemptStatus.succeeded,
        providerTransactionId: params.providerTransactionId,
        paidAt: new Date(),
        callbackPayload: {
          merchantPaymentNo: params.merchantPaymentNo,
          transactionId: params.providerTransactionId,
          amountFen: params.refundAmount,
          receivedAt: new Date().toISOString(),
          anomalous: true,
          cancelReason: params.cancelReason,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // 创建退款任务
    await this.refundService.createRefundTaskInTransaction(tx, {
      orderId: params.orderId,
      storeId: params.storeId,
      paymentAttemptId: params.paymentAttemptId,
      triggerType: 'anomalous_payment',
      refundAmount: params.refundAmount,
      merchantPaymentNo: params.merchantPaymentNo,
      providerTransactionId: params.providerTransactionId,
      operatorType: 'payment_callback',
      failureReason: `订单已关闭(${params.cancelReason})，收到支付成功回调，需退款处理`,
    });

    // 写入异常支付状态历史
    await tx.scanOrderStatusHistory.create({
      data: {
        orderId: params.orderId,
        storeId: params.storeId,
        fromStatus: 'cancelled',
        toStatus: 'cancelled',
        operatorType: 'payment_callback',
        reason: `异常支付回调: transactionId=${params.providerTransactionId}, amount=${params.refundAmount}分, 已创建退款任务`,
      },
    });

    this.logger.error(
      `扫码点餐异常支付已记录退款任务: orderId=${params.orderId}, ` +
        `merchantPaymentNo=${params.merchantPaymentNo}, ` +
        `transactionId=${params.providerTransactionId}, ` +
        `amount=${params.refundAmount}分, ` +
        `cancelReason=${params.cancelReason}`,
    );
  }
}
