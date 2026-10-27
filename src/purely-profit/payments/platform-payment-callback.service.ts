// 平台收款统一回调分发：验签 → 解密 → 按支付单的 bizType 派发给对应业务入账
//
// 会员开通 / 新客额度充值两条链路共用这个回调地址（/profit/payments/wechat/callback）：
// 省掉两份重复的验签解密实现，也只需要维护一份 rawBody 白名单。
//
// 短信钱包充值**不走这里**：它的订单在 sms_recharge_orders（SM 前缀），
// 有自己的回调路由 /marketing/sms/wechat/callback，两边不可混配。
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClubPaymentCallbackSignatureService } from '../../purely-club/payments/club-payment-callback-signature.service';
import type { ClubWechatCallbackHeaders } from '../../purely-club/payments/club-payments.types';
import type { WechatDecryptedTransaction } from '../../purely-club/payments/dto/club-wechat-callback.dto';
import { PlatformMembershipPaymentService } from '../member/platform-membership/platform-membership-payment.service';
import { NewCustomerQuotaRechargeService } from '../member/new-customer-quota/new-customer-quota-recharge.service';
import { PlatformWechatCallbackDecryptorService } from './platform-wechat-callback-decryptor.service';
import { PlatformPaymentOrderService } from './platform-payment-order.service';
import { PlatformPaymentRealtimeService } from './platform-payment-realtime.service';

/** 微信回调期望的应答体：非 SUCCESS 会触发微信重试 */
export interface WechatCallbackReply {
  code: string;
  message?: string;
}

@Injectable()
export class PlatformPaymentCallbackService {
  private readonly logger = new Logger(PlatformPaymentCallbackService.name);

  constructor(
    private readonly signatureService: ClubPaymentCallbackSignatureService,
    private readonly decryptorService: PlatformWechatCallbackDecryptorService,
    private readonly paymentOrderService: PlatformPaymentOrderService,
    private readonly quotaRechargeService: NewCustomerQuotaRechargeService,
    private readonly membershipPaymentService: PlatformMembershipPaymentService,
    private readonly configService: ConfigService,
    private readonly realtimeService: PlatformPaymentRealtimeService,
  ) {}

  /** 处理一次微信支付回调；任何业务失败都返回 SUCCESS 之外的码以触发重试 */
  async handleCallback(params: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
    payload: unknown;
  }): Promise<WechatCallbackReply> {
    try {
      // 验签是防护的第一道门：失败必须拒绝，不能因为「解密也解不开」就放行
      this.signatureService.assertWechatCallbackSignature(
        params.rawBody,
        this.readSignatureHeaders(params.headers),
      );
    } catch (error: unknown) {
      this.logger.warn(
        `[平台收款回调] 验签失败，已拒绝: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { code: 'FAIL', message: '签名校验失败' };
    }

    let decrypted: WechatDecryptedTransaction;
    try {
      decrypted = this.decryptorService.decryptCallback(
        params.payload as Parameters<
          PlatformWechatCallbackDecryptorService['decryptCallback']
        >[0],
      );
    } catch (error: unknown) {
      this.logger.error(
        `[平台收款回调] 报文解密失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { code: 'FAIL', message: '回调报文解密失败' };
    }

    try {
      return await this.dispatchByBizType(decrypted);
    } catch (error: unknown) {
      // 入账失败必须回 FAIL 让微信重投，绝不能吞成 SUCCESS 造成「已付款未开通」
      this.logger.error(
        `[平台收款回调] ${decrypted.out_trade_no ?? ''} 入账失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { code: 'FAIL', message: '入账处理失败' };
    }
  }

  /** 按支付单业务类型分发入账 */
  private async dispatchByBizType(
    decrypted: WechatDecryptedTransaction,
  ): Promise<WechatCallbackReply> {
    const orderNo = decrypted.out_trade_no ?? '';
    const transactionId = decrypted.transaction_id ?? '';

    if (decrypted.trade_state !== 'SUCCESS') {
      this.logger.warn(
        `[平台收款回调] ${orderNo} 交易状态为 ${decrypted.trade_state ?? '未知'}，不做事`,
      );
      return { code: 'SUCCESS' };
    }

    // 商户号必须与平台收款商户号一致：多个商户号共用同一个回调地址时，
    // 不校验就可能把别家的支付结果记到自己的单上
    const expectedMchId = this.configService
      .get<string>('wechat.payMchId')
      ?.trim();
    if (expectedMchId && decrypted.mchid !== expectedMchId) {
      this.logger.error(
        `[平台收款回调] ${orderNo} 商户号不匹配：期望 ${expectedMchId}，实际 ${decrypted.mchid ?? '空'}`,
      );
      return { code: 'FAIL', message: '商户号不匹配' };
    }

    const order = await this.paymentOrderService.findByOrderNo(orderNo);
    if (!order) {
      this.logger.error(`[平台收款回调] 支付单不存在: ${orderNo}`);
      return { code: 'FAIL', message: '支付单不存在' };
    }

    // 金额唯一权威是后端落单金额：回调金额缺失或对不上，一律拒绝入账。
    // 回 SUCCESS 会让这笔异常回调被微信认为已处理，之后再也没人对账。
    const paidAmountFen = decrypted.amount?.total;
    if (typeof paidAmountFen !== 'number' || paidAmountFen <= 0) {
      this.logger.error(`[平台收款回调] ${orderNo} 缺少支付金额，拒绝入账`);
      return { code: 'FAIL', message: '回调缺少支付金额' };
    }

    if (paidAmountFen !== order.amountFen) {
      this.logger.error(
        `[平台收款回调] ${orderNo} 金额不一致：落单 ${order.amountFen} 分，回调 ${paidAmountFen} 分，拒绝入账`,
      );
      return { code: 'FAIL', message: '支付金额与订单金额不一致' };
    }

    if (order.bizType === 'new_customer_quota') {
      await this.quotaRechargeService.settleByOrderNo({
        orderNo,
        transactionId,
        amountFen: paidAmountFen,
      });
      this.realtimeService.publishPaid(orderNo, new Date().toISOString());
      return { code: 'SUCCESS' };
    }

    if (order.bizType === 'membership') {
      await this.membershipPaymentService.activateByPaymentOrderNo({
        paymentOrderNo: orderNo,
        transactionId,
        amountFen: paidAmountFen,
      });
      this.realtimeService.publishPaid(orderNo, new Date().toISOString());
      return { code: 'SUCCESS' };
    }

    if (order.bizType === 'sms_recharge') {
      // 短信充值走独立的 sms_recharge_orders 链路，不会生成平台支付单。
      // 真走到这里说明数据串了：置 failed 让它在对账里可见，并回 SUCCESS ——
      // 重投再多次也不会凭空长出一个入账处理器，只会刷屏并拖慢后续回调。
      await this.paymentOrderService.markFailed(orderNo);
      this.realtimeService.publishFailed(orderNo);
      this.logger.error(
        `[平台收款回调] ${orderNo} 属于短信充值链路，不应出现在平台支付单中，已置 failed`,
      );
      return { code: 'SUCCESS' };
    }

    // 其余情况（将来新增但尚未接入入账的 bizType）：保持 pending 并显式失败，
    // 既触发微信重投，也把「已付款但无处入账」留在对账里等人工处理
    this.logger.error(
      `[平台收款回调] 支付单 ${orderNo} 的业务类型 ${order.bizType} 尚无入账处理器`,
    );
    return { code: 'FAIL', message: '业务类型未接入' };
  }

  /** 从请求头中读取微信回调验签所需的字段 */
  private readSignatureHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): ClubWechatCallbackHeaders {
    const read = (key: string): string => {
      const value = headers[key];
      return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
    };

    return {
      timestamp: read('wechatpay-timestamp'),
      nonce: read('wechatpay-nonce'),
      signature: read('wechatpay-signature'),
      serial: read('wechatpay-serial'),
    };
  }
}
