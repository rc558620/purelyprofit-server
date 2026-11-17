import { ConflictException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';

/**
 * 扫码点餐建单的幂等记录读写。
 *
 * 从 `ClubScanOrderingOrderService.create` 抽出的原因：幂等占位记录既不需要与
 * 订单同事务（`scope + actorId + idempotencyKey` 唯一键本身就是并发闸门），
 * 又能借此把建单事务从 9 次往返压到 7 次，缩短库存 / 会话 / 新客额度这些行锁
 * 的持有时间。三次访问（占位 → 成功回填 → 失败清理）集中在这里，避免把
 * 生命周期散落在业务方法里。
 *
 * 关键不变量：**只有事务确定未提交时才允许删除占位记录**。事务一旦提交，
 * 删掉占位会让同 key 重试再建一单，等于绕过幂等。
 */

export interface CreateIdempotencyPlaceholderInput {
  scope: string;
  actorId: number;
  idempotencyKey: string;
  requestHash: string;
  expiresAt: Date;
}

/** 幂等记录中建单路径关心的最小字段 */
export interface IdempotencyRecordSnapshot {
  status: string;
  responseSnapshot: unknown;
}

/** 读取幂等记录：scope + actorId + key 唯一键，缺任一维度都不会误命中。 */
export const findIdempotencyRecord = (
  prisma: PrismaService,
  input: { scope: string; actorId: number; idempotencyKey: string },
): Promise<IdempotencyRecordSnapshot | null> =>
  prisma.idempotencyRecord.findUnique({
    where: { scope_actorId_idempotencyKey: input },
  });

/**
 * 已存在记录时的处理：成功快照原样回放（客户端拿到首次的订单 ID 与版本）；
 * 记录仍停在 processing 时提示「正在创建中」，让客户端按同一 key 重试，
 * 而不是再发起一笔新订单。
 */
export const resolveExistingIdempotencyResponse = (
  record: IdempotencyRecordSnapshot,
): unknown => {
  if (record.status === 'succeeded' && record.responseSnapshot) {
    return record.responseSnapshot;
  }
  throw new ConflictException(
    clubScanOrderingError(
      CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_CREATING,
      '订单正在创建中，请稍后重试',
    ),
  );
};

/** 占位写入：唯一键冲突直接抛给调用方按「并发同 key」处理。 */
export async function createIdempotencyPlaceholder(
  prisma: PrismaService,
  input: CreateIdempotencyPlaceholderInput,
): Promise<number> {
  const record = await prisma.idempotencyRecord.create({
    data: {
      scope: input.scope,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      status: 'processing',
      expiresAt: input.expiresAt,
    },
    select: { id: true },
  });
  return record.id;
}

/**
 * 事务提交后回填响应快照。
 *
 * 失败只记日志：订单已经真实落库，此时让接口报错反而会误导用户重复下单；
 * 记录停在 `processing` 时同 key 重试会拿到「正在创建中」，不会产生第二单。
 */
export async function finalizeIdempotencyPlaceholder(
  prisma: PrismaService,
  id: number,
  snapshot: unknown,
  logger: Logger,
  resourceId?: number,
): Promise<void> {
  try {
    await prisma.idempotencyRecord.update({
      where: { id },
      data: {
        status: 'succeeded',
        resourceType: 'scan_order',
        resourceId,
        responseSnapshot: snapshot as object,
      },
    });
  } catch (error) {
    logger.warn(
      `回填幂等响应快照失败 id=${id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** 事务未提交时清理占位记录，允许同 key 重试。 */
export async function discardIdempotencyPlaceholder(
  prisma: PrismaService,
  id: number,
  logger: Logger,
): Promise<void> {
  try {
    await prisma.idempotencyRecord.delete({ where: { id } });
  } catch (error) {
    logger.warn(
      `清理幂等占位记录失败 id=${id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
