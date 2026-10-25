import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClubPaymentCallbackSignatureService } from '../../../purely-club/payments/club-payment-callback-signature.service';
import type { WechatDecryptedTransaction } from '../../../purely-club/payments/dto/club-wechat-callback.dto';
import { SmsRechargeService } from './sms-recharge.service';
import { SmsWechatCallbackDecryptorService } from './sms-wechat-callback-decryptor.service';
import type {
  SmsWechatCallbackAckDto,
  SmsWechatCallbackDto,
} from './dto/sms.dto';
import { isSmsOrderNo } from './dto/sms.dto';

/** 与 club 侧 `ClubWechatCallbackHeaders` 同构，独立定义避免反向依赖 club 模块 */
export interface SmsWechatCallbackHeaders {
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
  serial: string | undefined;
}

/**
 * 短信钱包充值的微信支付回调处理。
 *
 * ⚠️ 这是**独立**回调，不复用 `/api/club/payments/wechat/callback`
 * （那是 C 端 club 订单上下文）。验签与解密复用现有实现，落账逻辑独立。
 */
@Injectable()
export class SmsRechargeCallbackService {
  private readonly logger = new Logger(SmsRechargeCallbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rechargeService: SmsRechargeService,
    private readonly signatureService: ClubPaymentCallbackSignatureService,
    private readonly decryptorService: SmsWechatCallbackDecryptorService,
  ) {}

  async handleWechatCallback(
    payload: SmsWechatCallbackDto,
    headers: SmsWechatCallbackHeaders,
    rawBody: string,
  ): Promise<SmsWechatCallbackAckDto> {
    this.signatureService.assertWechatCallbackSignature(rawBody, headers);

    const transaction: WechatDecryptedTransaction =
      this.decryptorService.decryptCallback(payload);

    const orderNo = transaction.out_trade_no ?? '';
    if (!isSmsOrderNo(orderNo)) {
      // 订单号不是 SM 前缀 → 说明 notify url 配错了，属于配置事故，必须留日志
      this.logger.error(
        `短信充值回调收到非短信订单号：${orderNo}，请检查 SMS_WECHAT_PAY_NOTIFY_URL 配置`,
      );
      return {
        success: false,
        orderNo,
        status: 'failed',
        message: '订单号不属于短信充值，已忽略',
      };
    }

    if (transaction.trade_state !== 'SUCCESS') {
      await this.rechargeService.markOrderFailed(orderNo);
      return {
        success: false,
        orderNo,
        status: 'failed',
        message: `微信支付状态为 ${transaction.trade_state}`,
      };
    }

    const order = await this.prisma.smsRechargeOrder.findUnique({
      where: { orderNo },
      select: {
        orderNo: true,
        storeId: true,
        amountFen: true,
        status: true,
      },
    });

    if (!order) {
      this.logger.error(`短信充值回调找不到订单：${orderNo}`);
      return {
        success: false,
        orderNo,
        status: 'failed',
        message: '订单不存在',
      };
    }

    this.assertCallbackAmount(transaction, order.amountFen, orderNo);

    const credited = await this.rechargeService.creditRecharge({
      orderNo,
      storeId: order.storeId,
      amountFen: order.amountFen,
      payMode: 'live',
      transactionId: transaction.transaction_id,
    });

    return {
      success: true,
      orderNo,
      status: 'paid',
      message: credited ? '充值已入账' : '重复回调，已忽略',
    };
  }

  /**
   * 回调金额必须存在且与订单金额严格一致。
   *
   * 金额是钱的唯一凭据：缺失或以「订单金额兜底」都等于按未知金额入账；
   * 不一致则是订单被改过或回调被伪造。两种情况都**不能入账**，
   * 也不能把订单标成 failed（钱可能真的收了），只能保持 pending 等人工核对。
   * 抛非 2xx 让微信继续重投，避免「钱已收、钱包没加、微信却停止重投」。
   */
  private assertCallbackAmount(
    transaction: WechatDecryptedTransaction,
    orderAmountFen: number,
    orderNo: string,
  ): void {
    const paidAmountFen = transaction.amount?.total;

    if (!Number.isInteger(paidAmountFen) || (paidAmountFen ?? 0) <= 0) {
      this.logger.error(
        `短信充值回调缺少有效金额，拒绝入账：orderNo=${orderNo}，回调金额=${String(paidAmountFen)}`,
      );
      throw new InternalServerErrorException(
        '支付回调缺少有效金额，暂不入账，等待重试',
      );
    }

    if (paidAmountFen !== orderAmountFen) {
      this.logger.error(
        `短信充值金额不一致，已拒绝入账：orderNo=${orderNo}，订单 ${orderAmountFen} 分，回调 ${String(paidAmountFen)} 分`,
      );
      throw new InternalServerErrorException(
        '支付金额与订单金额不一致，暂不入账，等待人工核对',
      );
    }
  }
}
