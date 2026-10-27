/**
 * 自助点单订单「微信侧主动核对 + 补落账」。
 *
 * 自助点单的 out_trade_no 不在订单表上，而是每次发起支付时写入
 * 支付尝试表的 merchantPaymentNo（格式 `${orderNo}-{4位随机}`），
 * 同一订单可能存在多条尝试，必须取最近一条微信渠道记录核对。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatVerifyService } from '../payments/club-wechat-verify.service';
import { WECHAT_PAYMENT_CHANNEL } from './club-self-ordering.utils';
import { ClubSelfOrderingPaymentService } from './club-self-ordering-payment.service';

@Injectable()
export class ClubSelfOrderingWechatVerifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubWechatVerifyService: ClubWechatVerifyService,
    private readonly clubSelfOrderingPaymentService: ClubSelfOrderingPaymentService,
  ) {}

  /**
   * 回微信侧核对自助点单订单，确认已支付则补落账。
   *
   * @returns true 表示本次确实补了落账（调用方据此决定是否需要重查）
   */
  async verifyAndSettle(userId: number, orderId: number): Promise<boolean> {
    const order = await this.prisma.selfOrder.findFirst({
      where: { id: orderId, clubUserId: userId, deletedAt: null },
      select: { id: true, storeId: true, paymentStatus: true },
    });

    // 已支付或不存在：交给正式查询链路返回，这里不重复核对
    if (!order || order.paymentStatus !== 'unpaid') {
      return false;
    }

    const attempt = await this.prisma.selfOrderPaymentAttempt.findFirst({
      where: { orderId: order.id, paymentChannel: WECHAT_PAYMENT_CHANNEL },
      orderBy: { createdAt: 'desc' },
      select: { merchantPaymentNo: true, amountFen: true },
    });

    // 没有微信支付尝试（例如只发起过余额支付）：无可核对的微信交易
    if (!attempt) {
      return false;
    }

    const verified = await this.clubWechatVerifyService.confirmPaidOnWechat({
      scope: 'self-ordering',
      storeId: order.storeId,
      outTradeNo: attempt.merchantPaymentNo,
      expectedAmountFen: attempt.amountFen,
    });

    if (!verified) {
      return false;
    }

    await this.clubSelfOrderingPaymentService.confirmOrderPaidByCallback(
      attempt.merchantPaymentNo,
      { ...verified, callbackReceivedAtMs: Date.now() },
    );

    return true;
  }
}
