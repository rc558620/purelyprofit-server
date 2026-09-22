// 录入订单幂等服务：幂等键校验、请求指纹、事务内占位/标记成功，以及幂等命中后的响应还原

import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { Money } from '../../../../shared/money.utils';
import type { ManualEntryOrderCreatedResponse } from './manual-entry.types';

/** 幂等记录作用域：商家端录入订单建单 */
const IDEMPOTENCY_SCOPE = 'profit:manual-entry:create';

/** 幂等记录保留时长：24 小时 */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** 幂等键最小长度：过短的占位值不视为有效键，避免误占键位 */
const IDEMPOTENCY_KEY_MIN_LENGTH = 8;

/** 事务内标记成功所需的订单快照 */
export interface ManualEntryIdempotencySnapshot {
  /** ScanOrders ID */
  orderId: number;
  /** 订单号（手工补录号段） */
  orderNo: string;
  /** 应付金额（分） */
  payableAmountCents: number;
  /** 创建时间 */
  createdAt: Date;
}

/** 幂等 key/记录处理服务（幂等键粒度的读写与回放）。 */
@Injectable()
export class ManualEntryIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /** 校验并回传幂等键；缺失或过短视为无效，避免无幂等保护直接建单。 */
  ensureValidKey(idempotencyKey: string | undefined): string {
    if (
      !idempotencyKey ||
      idempotencyKey.trim().length < IDEMPOTENCY_KEY_MIN_LENGTH
    ) {
      throw new ConflictException('请提供有效的 Idempotency-Key 以录入订单');
    }
    return idempotencyKey;
  }

  /** 请求指纹：同一草稿重复提交时用于比对幂等记录是否同一请求。 */
  hashRequest(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  /** 读取当前操作人的幂等记录（提交前查重与并发撞键回归共用）。 */
  find(actorId: number, idempotencyKey: string) {
    return this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_actorId_idempotencyKey: {
          scope: IDEMPOTENCY_SCOPE,
          actorId,
          idempotencyKey,
        },
      },
    });
  }

  /** 校验幂等记录来自同一请求指纹，避免不同草稿复用同一幂等键。 */
  ensureSameRequest(
    record: { requestHash: string },
    requestHash: string,
  ): void {
    if (record.requestHash !== requestHash) {
      throw new ConflictException('幂等键已被其他录入请求使用，请刷新后重试');
    }
  }

  /** 事务内占位：抢占幂等键；并发双击时后到者撞唯一键并由事务回滚。 */
  async claim(
    tx: Prisma.TransactionClient,
    actorId: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        scope: IDEMPOTENCY_SCOPE,
        actorId,
        idempotencyKey,
        requestHash,
        status: 'processing',
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  }

  /** 事务内标记成功并关联 scan_order，同时写入响应快照供后续重放。 */
  async markSucceeded(
    tx: Prisma.TransactionClient,
    actorId: number,
    idempotencyKey: string,
    snapshot: ManualEntryIdempotencySnapshot,
  ): Promise<void> {
    await tx.idempotencyRecord.updateMany({
      where: {
        scope: IDEMPOTENCY_SCOPE,
        actorId,
        idempotencyKey,
        status: 'processing',
      },
      data: {
        status: 'succeeded',
        resourceType: 'scan_order',
        resourceId: snapshot.orderId,
        responseSnapshot: {
          orderId: snapshot.orderId,
          orderNo: snapshot.orderNo,
          payableAmount: Money.fromDbCents(
            snapshot.payableAmountCents,
          ).toOutputYuan(),
          createdAt: snapshot.createdAt.getTime(),
        },
      },
    });
  }

  /** 幂等命中后从 scan_orders 还原响应。 */
  async resolveExistingResponse(
    scanOrderId: number | null,
  ): Promise<ManualEntryOrderCreatedResponse> {
    if (scanOrderId === null) {
      throw new ConflictException('订单正在处理中，请稍后刷新查看结果');
    }
    const order = await this.prisma.scanOrders.findUnique({
      where: { id: scanOrderId },
      select: { id: true, orderNo: true, payableAmount: true, createdAt: true },
    });
    if (!order) {
      throw new NotFoundException('录入订单不存在，请刷新后重试');
    }
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      payableAmount: Money.fromDbCents(order.payableAmount).toOutputYuan(),
      createdAt: order.createdAt.getTime(),
    };
  }
}
