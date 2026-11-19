// 团购券退款的「占位 / 终态 / 回补」事务辅助：与退款资格裁决、外部渠道调用分离
//
// 退款必须先占位再出款：占位前出款会出现「钱已退、券仍可开台」；
// 占位即把 refund_no 写入订单行（唯一索引 + 条件更新），
// 开台与核销的原子更新都要求 refund_no IS NULL，从而在数据库层互斥。
import { BadRequestException, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import {
  restorePointsAndStock,
  restoreVoucherBalance,
} from './club-voucher-order-refund-restore.helper';
import type { RefundRestoreOrder } from './club-voucher-order-refund-restore.helper';
import type { ClubVoucherErrorPayload } from './club-voucher-orders.errors';

const logger = new Logger('ClubVoucherOrderRefundSettlement');

/** 可退款状态：pending（待使用）与 used-未开台 */
export const REFUNDABLE_STATUSES = ['pending', 'used'] as const;

/** 拒绝经办人快照 */
export interface RefundOperator {
  name: string | null;
  role: 'owner' | 'manager' | 'staff' | null;
}

/** 落终态所需参数 */
export interface TerminalRefundParams {
  orderId: number;
  orderNo: string;
  paidAmountFen: number;
  channel: 'wechat' | 'balance';
  refundNo: string;
  /** 商家拒绝时写入的经办人；用户主动退款为空 */
  rejectBy?: RefundOperator;
  /** 占位是否已在本函数之外写入（中断恢复场景） */
  slotClaimed: boolean;
  /** 并发抢占失败时抛给前端的业务异常载荷 */
  conflict: ClubVoucherErrorPayload;
}

/** 退款行更新条件：必须仍是可退状态、未绑定会话 */
function buildRefundWhere(
  orderId: number,
  refundNo: string,
  slotClaimed: boolean,
): Prisma.ClubVoucherOrderWhereInput {
  return {
    id: orderId,
    status: { in: [...REFUNDABLE_STATUSES] },
    usedSessionId: null,
    // 未占位时必须仍是「无退款单」；已占位时必须仍是本次退款单，避免并发覆盖
    refundNo: slotClaimed ? refundNo : null,
  };
}

/** 退款终态写入字段（两条渠道共用，只有渠道字段不同） */
function buildRefundedData(
  paidAmountFen: number,
  channel: 'wechat' | 'balance',
  refundNo: string,
  rejectBy?: RefundOperator,
): Prisma.ClubVoucherOrderUpdateManyMutationInput {
  return {
    status: 'refunded',
    refundAt: new Date(),
    refundAmountFen: paidAmountFen,
    refundChannel: channel,
    refundNo,
    ...(rejectBy
      ? {
          rejectedAt: new Date(),
          rejectedByStaffName: rejectBy.name,
          rejectedByStaffRole: rejectBy.role,
        }
      : {}),
  };
}

/**
 * 原子占位：把 refund_no 写到订单行，作为「退款进行中」标记。
 * @returns 是否抢到占位；false 表示已被并发退款或开台抢占
 */
export async function claimRefundSlot(
  prisma: PrismaService,
  orderId: number,
  refundNo: string,
): Promise<boolean> {
  const claimed = await prisma.clubVoucherOrder.updateMany({
    where: buildRefundWhere(orderId, refundNo, false),
    data: { refundNo },
  });
  return claimed.count === 1;
}

/** 释放占位：仅在确认渠道退款未成功时调用 */
export async function releaseRefundSlot(
  prisma: PrismaService,
  orderId: number,
  refundNo: string,
): Promise<void> {
  await prisma.clubVoucherOrder.updateMany({
    where: {
      id: orderId,
      refundNo,
      status: { in: [...REFUNDABLE_STATUSES] },
    },
    data: { refundNo: null },
  });
}

/**
 * 落退款终态：状态回写 + 积分/库存回补（余额渠道再回补储值余额），同一事务。
 *
 * 回补失败会整体回滚：微信渠道留下 refund_no 占位（下次凭查单补齐），
 * 余额渠道不留任何痕迹，绝不会出现「已退款但余额没退」。
 */
export async function settleRefundTerminal(
  prisma: PrismaService,
  order: RefundRestoreOrder & { id: number },
  params: TerminalRefundParams,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const updated = await tx.clubVoucherOrder.updateMany({
        where: buildRefundWhere(
          params.orderId,
          params.refundNo,
          params.slotClaimed,
        ),
        data: buildRefundedData(
          params.paidAmountFen,
          params.channel,
          params.refundNo,
          params.rejectBy,
        ),
      });
      if (updated.count !== 1) {
        // 渠道已出款但本地未落账：必须留痕，按退款单号到商户平台人工核对
        if (params.channel === 'wechat') {
          logger.error(
            `团购券退款落库失败，微信侧已出款，请人工核对: orderNo=${params.orderNo}, refundNo=${params.refundNo}`,
          );
        }
        throw new BadRequestException(params.conflict);
      }

      await restorePointsAndStock(tx, order);
      if (params.channel === 'balance') {
        await restoreVoucherBalance(tx, order);
      }
    },
    { timeout: TX_TIMEOUT_MEDIUM },
  );
}
