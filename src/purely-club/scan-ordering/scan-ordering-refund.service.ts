import { Injectable } from '@nestjs/common';
import { Prisma, ScanOrderRefundTaskStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';

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

/** 扫码点餐退款任务服务，仅由系统异常支付与商家拒单流程创建任务。 */
@Injectable()
export class ScanOrderingRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  async createRefundTask(
    input: CreateRefundTaskInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const create = async (client: Prisma.TransactionClient): Promise<void> => {
      const existing = await client.scanOrderRefundTask.findFirst({
        where: {
          orderId: input.orderId,
          status: { in: ['pending', 'refunding', 'manual_pending'] },
        },
      });
      if (existing) return;
      await client.scanOrderRefundTask.create({
        data: {
          orderId: input.orderId,
          storeId: input.storeId,
          paymentAttemptId: input.paymentAttemptId,
          triggerType: input.triggerType,
          refundNo: this.refundNo(),
          refundAmount: input.refundAmount,
          merchantPaymentNo: input.merchantPaymentNo,
          providerTransactionId: input.providerTransactionId,
          operatorType: input.operatorType ?? 'system',
          operatorId: input.operatorId,
          failureReason: input.failureReason,
          status: ScanOrderRefundTaskStatus.manual_pending,
        },
      });
    };
    if (tx) return create(tx);
    await this.prisma.$transaction(create);
  }

  async createRefundTaskInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateRefundTaskInput,
  ): Promise<void> {
    await this.createRefundTask(input, tx);
  }

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
        status: { in: ['pending', 'refunding', 'manual_pending'] },
      },
      data: {
        status: ScanOrderRefundTaskStatus.succeeded,
        processedAt: new Date(),
        refundSucceededAt: new Date(),
        providerRefundNo: params.providerRefundNo,
        providerRefundId: params.providerRefundId,
      },
    });
  }

  private refundNo(): string {
    return `SR${Date.now()}${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
