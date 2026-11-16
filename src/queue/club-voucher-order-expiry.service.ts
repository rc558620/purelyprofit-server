import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 单批翻转行数：控制单条 UPDATE 的行锁范围与执行时长 */
const EXPIRY_BATCH_SIZE = 500;

/** 单次任务最多处理的批次数：兜底防止异常数据导致单次任务长期占用 worker */
const EXPIRY_MAX_BATCHES = 20;

/**
 * 团购券订单过期翻转服务。
 *
 * 背景：过期翻转原先挂在 C 端列表 / 详情读接口里（懒过期写），
 * 读接口夹带写操作会在高并发读时放大写压力、并让只读请求也持有写事务。
 * 现改为独立定时任务承担，读接口只在返回态派生 expired。
 *
 * 语义不变性：过期券不可用的判定在核销（`club-voucher-order-verify.service.ts`）
 * 与退款（`club-voucher-order-refund.service.ts`）两条写入链路上各自按 `expiresAt`
 * 独立拦截，不依赖这里的翻转结果，所以翻转时机只影响展示而不会放宽可用性。
 *
 * 并发安全：
 * - BullMQ repeatable job 在 Redis 侧唯一，多 worker 只有一个实例执行；
 * - 翻转语句带 `status: 'pending'` 前置条件，即使被并发执行，
 *   同一行也只有一次能命中，`count` 不会重复累计（影响行数即真实翻转数）。
 */
@Injectable()
export class ClubVoucherOrderExpiryService {
  private readonly logger = new Logger(ClubVoucherOrderExpiryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 批量把「已过有效期且仍为 pending」的订单翻转为 expired。
   *
   * @returns 本次实际翻转的订单数（以 UPDATE 影响行数为准）
   */
  async expireOverdueOrders(): Promise<number> {
    const startedAt = Date.now();
    const now = new Date();
    let expired = 0;

    for (let batch = 0; batch < EXPIRY_MAX_BATCHES; batch += 1) {
      const rows = await this.prisma.clubVoucherOrder.findMany({
        where: { status: 'pending', expiresAt: { lt: now } },
        orderBy: { id: 'asc' },
        take: EXPIRY_BATCH_SIZE,
        select: { id: true },
      });
      if (rows.length === 0) {
        break;
      }

      const result = await this.prisma.clubVoucherOrder.updateMany({
        // 前置状态条件 + 有效期条件：并发下被别的实例抢先翻转的行不会重复计数
        where: {
          id: { in: rows.map((row) => row.id) },
          status: 'pending',
          expiresAt: { lt: now },
        },
        data: { status: 'expired' },
      });
      expired += result.count;

      if (rows.length < EXPIRY_BATCH_SIZE) {
        break;
      }
    }

    this.logger.log(
      `[club-voucher-order-expiry] expired=${expired} durationMs=${Date.now() - startedAt}`,
    );
    return expired;
  }
}
