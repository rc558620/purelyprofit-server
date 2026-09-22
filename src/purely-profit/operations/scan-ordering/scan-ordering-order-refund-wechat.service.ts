import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';
import { ClubWechatRefundService } from '../../../purely-club/payments/club-wechat-refund.service';
import { ScanOrderingRefundTransitionService } from './scan-ordering-refund-transition.service';
import { ScanOrderingRefundRealtimeService } from './scan-ordering-refund-realtime.service';
import type {
  AutoWechatRefundInput,
  RefundProviderInfo,
  RetryWechatRefundInput,
} from './scan-ordering-refund.types';

/**
 * 扫码点餐微信支付退款服务。
 *
 * 负责系统超时自动退款与失败重试：创建退款任务、调用微信退款 API，
 * 成功后闭环订单状态，失败则保留人工待处理任务由商家兜底。
 */
@Injectable()
export class ScanOrderingOrderRefundWechatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refundService: ScanOrderingRefundService,
    private readonly wechatRefundService: ClubWechatRefundService,
    private readonly transitionService: ScanOrderingRefundTransitionService,
    private readonly realtimeService: ScanOrderingRefundRealtimeService,
  ) {}

  /** 系统超时微信退款：置退款中 → 建任务 → 调微信 API → 完成闭环。
   * 微信 API 调用失败时订单停留在退款中、任务为人工待处理，由商家确认兜底。 */
  async initiateAutoWechatRefund(input: AutoWechatRefundInput): Promise<void> {
    await this.transitionService.markOrderRefunding(
      {
        orderId: input.orderId,
        storeId: input.storeId,
        version: input.version,
        reason: input.reason,
      },
      input.fromStatus,
    );
    const refundNo = await this.refundService.createRefundTask({
      orderId: input.orderId,
      storeId: input.storeId,
      paymentAttemptId: input.paymentAttempt?.id ?? null,
      triggerType: 'system_timeout',
      refundAmount: input.paidAmount,
      merchantPaymentNo: input.paymentAttempt?.merchantPaymentNo ?? null,
      providerTransactionId:
        input.paymentAttempt?.providerTransactionId ?? null,
      operatorType: 'system',
      failureReason: `系统超时自动退款：${input.reason}`,
    });
    const provider = await this.requestWechatRefund({
      storeId: input.storeId,
      merchantPaymentNo: input.paymentAttempt?.merchantPaymentNo ?? null,
      refundNo,
      amount: input.paidAmount,
      reason: input.reason,
    });
    const updated = await this.prisma.$transaction((tx) =>
      this.transitionService.completeRefund(tx, {
        orderId: input.orderId,
        storeId: input.storeId,
        version: input.version,
        operatorType: 'system',
        provider,
      }),
    );
    if (updated) this.realtimeService.publishRefundCompleted(updated);
  }

  /** 重试退款中订单：复用原退款单号，避免第三方重复生成退款单。 */
  async retryAutoWechatRefund(input: RetryWechatRefundInput): Promise<void> {
    const task = await this.findRetryableTask(input);
    if (!task || task.retryCount !== input.retryCount) return;
    const updatedTask = await this.prisma.scanOrderRefundTask.updateMany({
      where: {
        orderId: input.orderId,
        refundNo: input.refundNo,
        status: 'manual_pending',
        retryCount: input.retryCount,
      },
      data: {
        status: 'refunding',
        retryCount: { increment: 1 },
        failureReason: null,
      },
    });
    if (updatedTask.count === 0) return;
    try {
      if (!task.merchantPaymentNo) {
        throw new Error('缺少微信原支付单号');
      }
      const { refundId } = await this.wechatRefundService.requestRefund({
        storeId: input.storeId,
        orderNo: task.merchantPaymentNo,
        refundNo: input.refundNo,
        totalFen: task.refundAmount,
        refundFen: task.refundAmount,
        reason: '系统超时自动退款重试',
      });
      const updated = await this.prisma.$transaction((tx) =>
        this.transitionService.completeRefund(tx, {
          orderId: input.orderId,
          storeId: input.storeId,
          version: input.version,
          operatorType: 'system',
          provider: { refundNo: input.refundNo, refundId },
        }),
      );
      if (updated) this.realtimeService.publishRefundCompleted(updated);
    } catch (error: unknown) {
      await this.markRetryFailed(input, error);
    }
  }

  /** 调用微信退款 API；缺失原支付单号时跳过调用（保留人工待处理任务）。
   * 微信原支付单号（out_trade_no）为支付尝试的商户单号。 */
  private async requestWechatRefund(input: {
    storeId: number;
    merchantPaymentNo: string | null;
    refundNo: string;
    amount: number;
    reason: string;
  }): Promise<RefundProviderInfo | undefined> {
    if (!input.merchantPaymentNo) return undefined;
    try {
      const { refundId } = await this.wechatRefundService.requestRefund({
        storeId: input.storeId,
        orderNo: input.merchantPaymentNo,
        refundNo: input.refundNo,
        totalFen: input.amount,
        refundFen: input.amount,
        reason: input.reason,
      });
      return { refundNo: input.refundNo, refundId };
    } catch (error: unknown) {
      await this.refundService.markRefundTaskFailed(
        input.storeId,
        input.refundNo,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /** 查询可重试的系统超时退款任务。 */
  private findRetryableTask(input: RetryWechatRefundInput) {
    return this.prisma.scanOrderRefundTask.findFirst({
      where: {
        orderId: input.orderId,
        refundNo: input.refundNo,
        status: { in: ['manual_pending', 'refunding'] },
        triggerType: 'system_timeout',
      },
      select: { merchantPaymentNo: true, refundAmount: true, retryCount: true },
    });
  }

  /** 重试失败：回写失败原因达到最大重试次数后标记失败并抛出。 */
  private async markRetryFailed(
    input: RetryWechatRefundInput,
    error: unknown,
  ): Promise<void> {
    const failed = input.retryCount + 1 >= input.maxRetries;
    await this.prisma.scanOrderRefundTask.updateMany({
      where: {
        orderId: input.orderId,
        refundNo: input.refundNo,
        status: 'refunding',
        retryCount: input.retryCount + 1,
      },
      data: {
        status: failed ? 'failed' : 'manual_pending',
        failureReason: error instanceof Error ? error.message : String(error),
        processedAt: failed ? new Date() : null,
        updatedAt: new Date(),
      },
    });
    if (failed) throw error;
  }
}
