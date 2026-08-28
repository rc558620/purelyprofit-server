import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ScanOrderPickupNumberStatus } from '@prisma/client';
import { getShanghaiDayStartMs } from '../../shared/shanghai-time.utils';

/** 取餐号分配结果。 */
export interface ScanOrderPickupAssignment {
  /** 取餐号数值。 */
  pickupNumber: number;
  /** 取餐号展示文案（如 001 / 1000）。 */
  pickupNumberLabel: string;
  /** 取餐号所属上海业务日（Asia/Shanghai 当日 00:00）。 */
  pickupBusinessDate: Date;
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 86_400_000;

/**
 * 扫码点餐取餐号分配服务。
 *
 * 核心规则：
 * - 取餐号按门店独立、按上海业务日（Asia/Shanghai）递增，00:00 后从 001 重新计数；
 * - 001-999 三位显示，1000 及以上直接显示；
 * - 通过「唯一约束 + 数据库原子递增」保证同门店同业务日并发不重复；
 * - 同一订单幂等：只能分配一次，重复支付回调 / 余额重复支付 / 开发环境确认支付都不重复占号。
 */
@Injectable()
export class ScanOrderingPickupNumberService {
  private readonly logger = new Logger(ScanOrderingPickupNumberService.name);

  /**
   * 计算任意瞬间所属的上海业务日。
   * @param nowMs - UTC 毫秒；默认当前时间
   */
  getShanghaiBusinessDate(nowMs = Date.now()): {
    /** 业务日（Date，仅含年月日，用于 db.Date 字段与计数表主键）。 */
    businessDate: Date;
    /** 业务日 00:00 对应的 UTC 毫秒。 */
    dayStartMs: number;
    /** 次日 00:00 对应的 UTC 毫秒。 */
    nextDayStartMs: number;
  } {
    const dayStartMs = getShanghaiDayStartMs(nowMs);
    const shanghai = new Date(dayStartMs + SHANGHAI_OFFSET_MS);
    const businessDate = new Date(
      Date.UTC(
        shanghai.getUTCFullYear(),
        shanghai.getUTCMonth(),
        shanghai.getUTCDate(),
      ),
    );
    return { businessDate, dayStartMs, nextDayStartMs: dayStartMs + DAY_MS };
  }

  /**
   * 格式化取餐号。
   * 001-999 补零三位显示；1000 及以上直接显示。
   */
  formatPickupNumber(number: number | null | undefined): string | null {
    if (
      typeof number !== 'number' ||
      !Number.isInteger(number) ||
      number <= 0
    ) {
      return null;
    }
    return number < 1000 ? String(number).padStart(3, '0') : String(number);
  }

  /**
   * 为已支付订单分配取餐号（事务内调用，幂等）。
   *
   * 并发安全流程：
   * 1. 幂等 upsert 计数行（store_id + business_date 唯一约束）；
   * 2. 通过单条 UPDATE ... RETURNING 原子读取并递增 next_number；
   * 3. 写入 ScanOrders 的取餐号字段。
   *
   * @param tx - 调用方开启的交互式事务
   * @param orderId - 订单 ID
   * @param storeId - 门店 ID
   * @param nowMs - 业务时点（默认当前时间；支付回调可传支付时间）
   * @returns 分配结果；若订单不存在、门店不匹配或已分配则返回 null
   */
  async assignForPaidOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
    storeId: number,
    nowMs = Date.now(),
  ): Promise<ScanOrderPickupAssignment | null> {
    const order = await tx.scanOrders.findUnique({
      where: { id: orderId },
      select: { storeId: true, pickupNumber: true },
    });
    if (!order || order.storeId !== storeId) return null;
    // 幂等：同一订单只能分配一次取餐号，重复支付回调不得重复占号
    if (order.pickupNumber != null) return null;

    const { businessDate } = this.getShanghaiBusinessDate(nowMs);
    const pickupNumber = await this.acquireNextNumber(
      tx,
      storeId,
      businessDate,
    );
    await tx.scanOrders.update({
      where: { id: orderId },
      data: {
        pickupNumber,
        pickupBusinessDate: businessDate,
        pickupAssignedAt: new Date(nowMs),
        pickupNumberStatus: ScanOrderPickupNumberStatus.assigned,
      },
    });

    this.logger.log(
      `扫码点餐取餐号已分配: orderId=${orderId}, storeId=${storeId}, ` +
        `businessDate=${businessDate.toISOString().slice(0, 10)}, number=${pickupNumber}, pid=${process.pid}`,
    );

    return {
      pickupNumber,
      pickupNumberLabel: this.formatPickupNumber(pickupNumber) ?? '',
      pickupBusinessDate: businessDate,
    };
  }

  /**
   * 读取并推进门店取餐号计数。
   * 唯一约束保证首次创建安全，单条 UPDATE ... RETURNING 保证并发递增安全。
   */
  private async acquireNextNumber(
    tx: Prisma.TransactionClient,
    storeId: number,
    businessDate: Date,
  ): Promise<number> {
    await tx.scanOrderingPickupSequence.upsert({
      where: { storeId_businessDate: { storeId, businessDate } },
      update: {},
      create: { storeId, businessDate, nextNumber: 1 },
    });

    const rows = await tx.$queryRaw<Array<{ next_number: number }>>(
      Prisma.sql`
        UPDATE "scan_ordering_pickup_sequences"
        SET "next_number" = "next_number" + 1,
            "updated_at" = NOW()
        WHERE "store_id" = ${storeId}
          AND "business_date" = ${businessDate}
        RETURNING "next_number" - 1 AS "next_number"
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('取餐号计数行不存在');
    return row.next_number;
  }
}
