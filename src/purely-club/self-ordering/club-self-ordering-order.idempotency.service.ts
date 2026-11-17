// 自助下单幂等闸门：键校验 → 命中回放 → 事务内占位抢占 → 成功落快照 → 失败兜底回放
//
// 从 ClubSelfOrderingOrderService 拆出的原因：幂等是「同一键只产生一笔订单」的
// 完整性约束，与落库快照、门禁、额度扣减无关；迁移到独立的幂等表或改用
// 幂等 token 时，改动应只落在本类。
import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CLUB_SELF_ORDERING_ERROR_CODE,
  clubSelfOrderingError,
} from './club-self-ordering.errors';
import { hashSelfOrderRequest } from './club-self-ordering.utils';
import type { SelfOrderIdempotencyRecord } from './club-self-ordering-order.mapper';
import type { SelfOrderCreation } from './club-self-ordering-order.types';

const IDEMPOTENCY_SCOPE = 'club:self-order:create';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * processing 占位记录的存活租约：进程在占位插入后崩溃/超时会留下永不完成的
 * processing 记录，阻塞同键重试直到 TTL。超过租约视为过期删除并允许重建——
 * 任何存活事务远早于 60s 完成，删除只可能命中崩溃残留，不会误删在途兄弟请求。
 */
const IDEMPOTENCY_PROCESSING_LEASE_MS = 60 * 1000;

/** 建单成功时写入幂等记录的字段（快照即对外响应体） */
export interface SelfOrderIdempotencySuccess {
  key: string;
  orderId: number;
  response: Record<string, unknown>;
}

@Injectable()
export class ClubSelfOrderingIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /** 校验并归一幂等键：缺失或过短一律拒绝建单 */
  requireKey(idempotencyKey: string | undefined): string {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new ConflictException(
        clubSelfOrderingError(
          CLUB_SELF_ORDERING_ERROR_CODE.PARAM_IDEMPOTENCY_KEY_INVALID,
          '请提供有效的 Idempotency-Key 以创建订单',
        ),
      );
    }
    return idempotencyKey.trim();
  }

  /** 同键已建单直接回放；崩溃残留的 processing 占位过期后删除并允许重建 */
  async replayExistingOrder(
    actorId: number,
    key: string,
  ): Promise<Record<string, unknown> | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: this.idempotencyWhere(actorId, key),
    });
    if (!existing) {
      return null;
    }

    if (
      existing.status === 'processing' &&
      Date.now() - existing.updatedAt.getTime() >
        IDEMPOTENCY_PROCESSING_LEASE_MS
    ) {
      await this.prisma.idempotencyRecord.deleteMany({
        where: {
          ...this.idempotencyWhere(actorId, key),
          status: 'processing',
          updatedAt: {
            lt: new Date(Date.now() - IDEMPOTENCY_PROCESSING_LEASE_MS),
          },
        },
      });
      return null;
    }

    return this.resolveRecord(existing);
  }

  /** 建单失败时的兜底：兄弟请求可能已建单成功，回放其结果 */
  async replayAfterFailure(
    error: unknown,
    actorId: number,
    key: string,
  ): Promise<Record<string, unknown> | null> {
    if (error instanceof ConflictException) {
      return null;
    }
    const created = await this.prisma.idempotencyRecord.findUnique({
      where: this.idempotencyWhere(actorId, key),
    });
    return created ? this.resolveRecord(created) : null;
  }

  /** 事务内插入占位记录抢占唯一索引，并发的兄弟请求会在此失败并走幂等回放 */
  async reserveRecord(
    tx: Prisma.TransactionClient,
    actorId: number,
    creation: SelfOrderCreation,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        scope: IDEMPOTENCY_SCOPE,
        actorId,
        idempotencyKey: creation.key,
        requestHash: hashSelfOrderRequest({
          sessionId: creation.dto.sessionId,
          // 用定价后的结果：同商品多行已合并，避免因行顺序不同算出不同指纹
          // 必须纳入 specSignature：同商品不同规格是不同订单，指纹不同才能在
          // 同幂等键下被识别为「内容不一致」而不是回放错误订单
          items: creation.priced.items.map((item) => [
            item.productId,
            item.specSignature ?? '',
            item.quantity,
          ]),
          remark: creation.dto.remark ?? null,
        }),
        status: 'processing',
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  }

  /** 事务内标记成功并落响应快照：同键重试直接回放，不再重复建单 */
  async markSucceeded(
    tx: Prisma.TransactionClient,
    actorId: number,
    success: SelfOrderIdempotencySuccess,
  ): Promise<void> {
    await tx.idempotencyRecord.update({
      where: this.idempotencyWhere(actorId, success.key),
      data: {
        status: 'succeeded',
        resourceType: 'self_order',
        resourceId: success.orderId,
        responseSnapshot: success.response as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private idempotencyWhere(actorId: number, key: string) {
    return {
      scope_actorId_idempotencyKey: {
        scope: IDEMPOTENCY_SCOPE,
        actorId,
        idempotencyKey: key,
      },
    };
  }

  private resolveRecord(
    record: SelfOrderIdempotencyRecord,
  ): Record<string, unknown> {
    if (record.status === 'succeeded' && record.responseSnapshot) {
      return record.responseSnapshot as Record<string, unknown>;
    }
    throw new ConflictException(
      clubSelfOrderingError(
        CLUB_SELF_ORDERING_ERROR_CODE.STATUS_ORDER_CREATING,
        '订单正在创建中，请稍后重试',
      ),
    );
  }
}
