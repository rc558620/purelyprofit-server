/**
 * 团购券订单「微信侧主动核对 + 补落账」。
 *
 * 团购券的 out_trade_no 就是订单号（orderNo 唯一键），金额取 paidAmountFen。
 * 只核对 unpaid：pending / used / refunded / expired 都已落账或已终结。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatVerifyService } from '../payments/club-wechat-verify.service';
import { ClubVoucherOrderPaymentService } from './club-voucher-order-payment.service';

/** 可核对状态：只有未支付的订单才可能因为在途回调而落后于微信侧 */
const VERIFIABLE_STATUS = 'unpaid';

@Injectable()
export class ClubVoucherOrderWechatVerifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubWechatVerifyService: ClubWechatVerifyService,
    private readonly clubVoucherOrderPaymentService: ClubVoucherOrderPaymentService,
  ) {}

  /**
   * 回微信侧核对团购券订单，确认已支付则补落账。
   *
   * @returns true 表示本次确实补了落账（调用方据此决定是否需要重查）
   */
  async verifyAndSettle(userId: number, orderNo: string): Promise<boolean> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo, userId },
      select: {
        storeId: true,
        orderNo: true,
        status: true,
        paidAmountFen: true,
      },
    });

    // 订单不存在或不属于当前用户：交给正式查询链路给出统一错误，这里静默跳过
    if (!order || order.status !== VERIFIABLE_STATUS) {
      return false;
    }

    const verified = await this.clubWechatVerifyService.confirmPaidOnWechat({
      scope: 'voucher',
      storeId: order.storeId,
      outTradeNo: order.orderNo,
      expectedAmountFen: order.paidAmountFen,
    });

    if (!verified) {
      return false;
    }

    await this.clubVoucherOrderPaymentService.confirmOrderPaidByCallback(
      order.orderNo,
      {
        amountFen: verified.amountFen,
        transactionId: verified.transactionId,
        paidAtMs: verified.paidAtMs,
      },
    );

    return true;
  }
}
