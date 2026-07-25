import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ScanOrderRefundTaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';

/**
 * 创建扫码点餐退款任务的输入参数。
 */
export interface CreateRefundTaskInput {
  orderId: number;
  storeId: number;
  paymentAttemptId?: number | null;
  triggerType: 'anomalous_payment' | 'merchant_reject';
  refundAmount: number;
  merchantPaymentNo?: string | null;
  providerTransactionId?: string | null;
  operatorType?: string;
  operatorId?: number | null;
  failureReason?: string | null;
}

/**
 * 扫码点餐退款处置服务。
 *
 * 职责：
 * - 在"已关闭订单收到支付成功回调"时创建退款任务并记录异常支付；
 * - 在"商家拒单已支付订单"时创建退款任务；
 * - 退款任务创建后推送订单状态变化事件；
 * - 后续接入微信退款 API 后，可通过本服务编排退款执行。
 *
 * 当前阶段：
 * - 微信退款 API 尚未封装，退款任务创建后进入 manual_pending（人工处理）状态；
 * - 不静默返回成功，所有异常支付均有退款任务可追踪。
 */
@Injectable()
export class ScanOrderingRefundService {
  private readonly logger = new Logger(ScanOrderingRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  /**
   * 创建退款任务并写入状态历史。
   *
   * 退款任务在事务内创建，保证与订单状态变更一致。
   * 创建后立即推送实时事件，通知 C 端和商家端。
   */
  async createRefundTask(
    input: CreateRefundTaskInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const createTask = async (client: Prisma.TransactionClient) => {
      const existing = await client.scanOrderRefundTask.findFirst({
        where: {
          orderId: input.orderId,
          triggerType: input.triggerType,
          status: { in: ['pending', 'refunding', 'manual_pending'] },
        },
        select: { id: true },
      });
      if (existing) return;

      const task = await client.scanOrderRefundTask.create({
        data: {
          orderId: input.orderId,
          storeId: input.storeId,
          paymentAttemptId: input.paymentAttemptId ?? null,
          triggerType: input.triggerType,
          status: 'manual_pending',
          refundAmount: input.refundAmount,
          merchantPaymentNo: input.merchantPaymentNo ?? null,
          providerTransactionId: input.providerTransactionId ?? null,
          operatorType: input.operatorType ?? 'system',
          operatorId: input.operatorId ?? null,
          failureReason: input.failureReason ?? null,
        },
      });

      this.logger.warn(
        `扫码点餐退款任务已创建: taskId=${task.id}, orderId=${input.orderId}, ` +
          `trigger=${input.triggerType}, amount=${input.refundAmount}分, ` +
          `merchantPaymentNo=${input.merchantPaymentNo ?? 'N/A'}, ` +
          `providerTransactionId=${input.providerTransactionId ?? 'N/A'}`,
      );
    };

    if (tx) {
      await createTask(tx);
      return;
    }
    await this.prisma.$transaction(async (transaction) => {
      await createTask(transaction);
    });
  }

  /**
   * 在事务内创建退款任务并发布实时事件。
   *
   * 适用于支付回调场景：事务内已修改了订单状态，
   * 退款任务在同一事务内创建保证一致性，事件在事务提交后发布。
   */
  async createRefundTaskInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateRefundTaskInput,
  ): Promise<void> {
    await this.createRefundTask(input, tx);
  }

  /**
   * 退款任务创建后推送订单状态变化事件。
   *
   * 在事务提交后调用，确保推送的事件基于已持久化的数据。
   */
  publishRefundStatusChanged(payload: {
    storeId: number;
    orderId: number;
    sessionId: number | null;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
  }): void {
    this.realtimeService.publishOrderStatusChanged(payload);
  }

  /**
   * 在事务内将退款任务标记为已成功。
   *
   * 仅处理处于 pending / refunding / manual_pending 状态的任务，
   * 已成功或已失败的任务不会被重复更新。
   */
  async markRefundTaskSucceededInTransaction(
    tx: Prisma.TransactionClient,
    params: {
      orderId: number;
      providerRefundNo?: string | null;
      providerRefundId?: string | null;
    },
  ): Promise<void> {
    await tx.scanOrderRefundTask.updateMany({
      where: {
        orderId: params.orderId,
        status: {
          in: [
            ScanOrderRefundTaskStatus.pending,
            ScanOrderRefundTaskStatus.refunding,
            ScanOrderRefundTaskStatus.manual_pending,
          ],
        },
      },
      data: {
        status: ScanOrderRefundTaskStatus.succeeded,
        refundSucceededAt: new Date(),
        ...(params.providerRefundNo
          ? { providerRefundNo: params.providerRefundNo }
          : {}),
        ...(params.providerRefundId
          ? { providerRefundId: params.providerRefundId }
          : {}),
      },
    });
  }
}
