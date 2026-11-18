/**
 * 扫码点餐「异常支付」落账。
 *
 * 微信成功回调到达时，订单可能已经不是「待支付」：
 * - 订单已关闭（用户取消 / 支付超时）→ 多收了一笔；
 * - 订单已由其他渠道收款（储值余额、开发态补录）→ 多收了一笔。
 *
 * 两种情形都不把订单改回已支付、也不重复扣库存：只把这次收款固化成
 * 退款任务并写状态流水，让资金闭环有据可查。回调整体按成功处理，
 * 避免微信持续重试。
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ScanOrderPaymentAttemptStatus } from '@prisma/client';
import type { ScanOrderStatus } from '@prisma/client';
import { ScanOrderingRefundService } from './scan-ordering-refund.service';

/** 异常支付回调的落账入参 */
export interface AnomalousPaymentParams {
  orderId: number;
  storeId: number;
  orderStatus: ScanOrderStatus;
  paymentAttemptId: number;
  merchantPaymentNo: string;
  providerTransactionId: string;
  refundAmount: number;
  /** 订单已关闭时的取消原因；重复收款场景传 null */
  cancelReason: string | null;
}

@Injectable()
export class ClubScanOrderingPaymentAnomalyService {
  private readonly logger = new Logger(
    ClubScanOrderingPaymentAnomalyService.name,
  );

  constructor(private readonly refundService: ScanOrderingRefundService) {}

  /** 已关闭订单收到支付成功回调：记退款任务，订单保持关闭。 */
  async recordClosedOrderPayment(
    tx: Prisma.TransactionClient,
    params: AnomalousPaymentParams,
  ): Promise<void> {
    const cancelReason = params.cancelReason ?? '未知';
    await this.recordRefundTask(tx, params, {
      flag: 'closed_order_payment',
      reason: `订单已关闭(${cancelReason})，收到支付成功回调，需退款处理`,
      logLabel: `扫码点餐已关闭订单收到支付: cancelReason=${cancelReason}`,
    });
  }

  /**
   * 订单已由其他渠道收款时收到微信成功回调：多收的钱按支付流水补退款任务。
   *
   * 与「已关闭订单」共用同一张退款任务（库内对订单做了唯一活跃任务约束），
   * 金额按笔累加，保证多次多收都能退全。
   */
  async recordDuplicatePayment(
    tx: Prisma.TransactionClient,
    params: AnomalousPaymentParams,
  ): Promise<void> {
    await this.recordRefundTask(tx, params, {
      flag: 'duplicate_payment',
      reason: `订单已由其他渠道收款（当前状态 ${params.orderStatus}），本次微信收款属多收，需退款处理`,
      logLabel: '扫码点餐重复收款',
    });
  }

  private async recordRefundTask(
    tx: Prisma.TransactionClient,
    params: AnomalousPaymentParams,
    meta: { flag: string; reason: string; logLabel: string },
  ): Promise<void> {
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
          anomalyType: meta.flag,
          orderStatus: params.orderStatus,
          cancelReason: params.cancelReason,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.refundService.createRefundTaskInTransaction(tx, {
      orderId: params.orderId,
      storeId: params.storeId,
      paymentAttemptId: params.paymentAttemptId,
      triggerType: 'anomalous_payment',
      refundAmount: params.refundAmount,
      merchantPaymentNo: params.merchantPaymentNo,
      providerTransactionId: params.providerTransactionId,
      operatorType: 'payment_callback',
      failureReason: meta.reason,
      accumulateAmount: true,
    });

    await tx.scanOrderStatusHistory.create({
      data: {
        orderId: params.orderId,
        storeId: params.storeId,
        fromStatus: params.orderStatus,
        toStatus: params.orderStatus,
        operatorType: 'payment_callback',
        reason: `异常支付回调: transactionId=${params.providerTransactionId}, amount=${params.refundAmount}分, 已创建退款任务`,
      },
    });

    this.logger.error(
      `${meta.logLabel}: orderId=${params.orderId}, ` +
        `merchantPaymentNo=${params.merchantPaymentNo}, ` +
        `transactionId=${params.providerTransactionId}, ` +
        `amount=${params.refundAmount}分, orderStatus=${params.orderStatus}`,
    );
  }
}
