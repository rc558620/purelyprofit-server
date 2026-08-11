// 团购券订单退款服务：pending / used-未开台 可退；微信原路退回 + 积分退回 + 库存回补（幂等）
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { ClubWechatRefundService } from '../payments/club-wechat-refund.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE,
  CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE,
} from './club-voucher-orders.constants';

/** 退款结果 */
export interface ClubVoucherRefundResult {
  orderNo: string;
  status: 'refunded';
  refundAt: string;
  refundAmountFen: number;
}

@Injectable()
export class ClubVoucherOrderRefundService {
  private readonly logger = new Logger(ClubVoucherOrderRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubWechatRefundService: ClubWechatRefundService,
  ) {}

  /** 用户端退款：pending / used-未开台 可退；used-已开台 禁止；幂等（已退款直接返回） */
  async refundVoucherOrder(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubVoucherRefundResult> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo, userId: currentContext.user.id },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }

    // 幂等：已退款直接返回
    if (order.status === 'refunded') {
      return {
        orderNo: order.orderNo,
        status: 'refunded',
        refundAt: this.formatDateTime(order.refundAt ?? new Date()),
        refundAmountFen: order.refundAmountFen ?? order.paidAmountFen,
      };
    }
    // 可退状态：pending（待使用）、used-未开台（已核销但未绑定开台会话）
    if (order.status === 'used' && order.usedSessionId !== null) {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE);
    }
    if (order.status !== 'pending' && order.status !== 'used') {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE);
    }

    const refundNo = this.buildRefundNo();

    // 先发起微信退款（幂等键 refundNo；开发态降级直接成功）
    const { refundId } = await this.clubWechatRefundService.requestRefund({
      storeId: order.storeId,
      orderNo: order.orderNo,
      refundNo,
      totalFen: order.paidAmountFen,
      refundFen: order.paidAmountFen,
      reason: '用户主动退款',
    });

    // 落库：置 refunded + 退款信息 + 积分退回 + 库存回补（同一事务）
    await this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.clubVoucherOrder.updateMany({
          where: {
            id: order.id,
            status: { in: ['pending', 'used'] },
            usedSessionId: null,
          },
          data: {
            status: 'refunded',
            refundAt: new Date(),
            refundAmountFen: order.paidAmountFen,
            refundChannel: 'wechat',
            refundNo,
          },
        });
        if (updated.count !== 1) {
          throw new BadRequestException(
            CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE,
          );
        }
        // 积分退回：实际扣减的积分回补到顾客积分账户，并记录流水（与扣减时 spend 流水对称，保证可审计）
        if (order.pointsUsed > 0 && order.customerId !== null) {
          await tx.marketingCustomer.update({
            where: { id: order.customerId },
            data: { points: { increment: order.pointsUsed } },
          });
          await tx.marketingPointsRecord.create({
            data: {
              storeId: order.storeId,
              customerId: order.customerId,
              amount: order.pointsUsed,
              type: 'earn' as const,
              description: `团购券退款返还积分（${order.productName}）`,
            },
          });
        }
        // 库存回补
        await tx.marketingProduct.update({
          where: { id: order.productId },
          data: { stock: { increment: order.quantity } },
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    this.logger.log(
      `团购券退款成功: orderNo=${order.orderNo}, refundNo=${refundNo}, 金额=${order.paidAmountFen}分, 微信退款单=${refundId}`,
    );
    return {
      orderNo: order.orderNo,
      status: 'refunded',
      refundAt: this.formatDateTime(new Date()),
      refundAmountFen: order.paidAmountFen,
    };
  }

  /** 生成退款单号：RF + 上海时区时间串 + 随机 HEX（全局唯一，幂等键） */
  private buildRefundNo(): string {
    const now = Date.now();
    const shanghai = new Date(now + 8 * 60 * 60_000);
    const pad = (value: number, width = 2): string =>
      String(value).padStart(width, '0');
    const serial = [
      shanghai.getUTCFullYear(),
      pad(shanghai.getUTCMonth() + 1),
      pad(shanghai.getUTCDate()),
      pad(shanghai.getUTCHours()),
      pad(shanghai.getUTCMinutes()),
      pad(shanghai.getUTCSeconds()),
      pad(shanghai.getUTCMilliseconds(), 3),
      randomBytes(2).toString('hex').toUpperCase(),
    ].join('');
    return `RF${serial}`;
  }

  private formatDateTime(date: Date): string {
    const shanghai = new Date(date.getTime() + 8 * 60 * 60_000);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return [
      shanghai.getUTCFullYear(),
      '-',
      pad(shanghai.getUTCMonth() + 1),
      '-',
      pad(shanghai.getUTCDate()),
      ' ',
      pad(shanghai.getUTCHours()),
      ':',
      pad(shanghai.getUTCMinutes()),
    ].join('');
  }
}

/** 导出类型供测试使用 */
export type VoucherRefundTx = Prisma.TransactionClient;
