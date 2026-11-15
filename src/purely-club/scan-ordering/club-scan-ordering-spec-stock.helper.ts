/**
 * 扫码点餐规格库存预留的批量写辅助。
 *
 * 独立成文件的原因：这里是事务内的 raw SQL 库存写，与「购物车金额计算」
 * 职责不同；拆开后定价服务不再直接持有库存更新语句，也便于单独回归乐观锁。
 */
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';

export interface SpecReservationUpdate {
  id: number;
  version: number;
  quantity: number;
}

/**
 * 一条 SQL 完成 N 行规格预留，避免事务内逐条往返。
 *
 * 乐观锁条件（is_active / version）逐行保留；影响行数不足即整体失败，
 * 由调用方事务回滚，不会出现部分规格预留成功。
 * 显式写 updated_at：raw SQL 不触发 Prisma 的 @updatedAt，按项目 SQL 时区规范用 UTC 墙钟。
 */
export async function applySpecReservationUpdates(
  tx: Prisma.TransactionClient,
  updates: SpecReservationUpdate[],
): Promise<void> {
  if (updates.length === 0) return;

  const valueRows = Prisma.join(
    updates.map(
      (update) =>
        Prisma.sql`(${update.id}::int, ${update.version}::int, ${update.quantity}::int)`,
    ),
  );

  const affected = await tx.$executeRaw`
    UPDATE scan_ordering_spec_options AS o
    SET reserved_quantity = o.reserved_quantity + v.quantity,
        version = o.version + 1,
        updated_at = NOW() AT TIME ZONE 'UTC'
    FROM (VALUES ${valueRows}) AS v(id, expected_version, quantity)
    WHERE o.id = v.id
      AND o.is_active = true
      AND o.version = v.expected_version
  `;

  if (affected !== updates.length) {
    throw new ConflictException(
      clubScanOrderingError(
        CLUB_SCAN_ORDERING_ERROR_CODE.RULE_STOCK_INSUFFICIENT,
        '规格库存不足',
      ),
    );
  }
}
