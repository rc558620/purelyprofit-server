import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClubPaymentCallbackSignatureService } from '../../../purely-club/payments/club-payment-callback-signature.service';
import type { WechatDecryptedTransaction } from '../../../purely-club/payments/dto/club-wechat-callback.dto';
import { SmsAccountService } from './sms-account.service';
import { SmsWechatCallbackDecryptorService } from './sms-wechat-callback-decryptor.service';
import { SmsWechatNativeService } from './sms-wechat-native.service';
import { SMS_RECHARGE_ORDER_TTL_SECONDS } from './sms.constants';
import type {
  SmsRechargeOrderResponseDto,
  SmsRechargeOrderStatusDto,
  SmsWechatCallbackAckDto,
  SmsWechatCallbackDto,
} from './dto/sms.dto';
import { isSmsOrderNo } from './dto/sms.dto';
import {
  buildSmsOrderNo,
  formatFenAmountDisplay,
  resolveSmsDirectCredit,
} from './sms.utils';

/** 与 club 侧 `ClubWechatCallbackHeaders` 同构，独立定义避免反向依赖 club 模块 */
export interface SmsWechatCallbackHeaders {
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
  serial: string | undefined;
}

/** 微信下单描述文案（微信限制 127 字符内） */
const ORDER_DESCRIPTION = '短信钱包充值';

/**
 * 短信钱包充值服务：下单、轮询状态、微信回调入账。
 *
 * 回调入账的两个铁律：
 * 1. **只有 status !== 'paid' 才入账**——微信会重复投递同一笔回调；
 * 2. 用条件更新（`where status != paid`）而非「先读后写」，
 *    否则并发的两次回调会各自读到 pending 并重复加钱。
 */
@Injectable()
export class SmsRechargeService {
  private readonly logger = new Logger(SmsRechargeService.name);

  /** 本地直充开关（构造时定格，运行中不会漂移） */
  private readonly directCredit: boolean;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
    private readonly accountService: SmsAccountService,
    private readonly nativeService: SmsWechatNativeService,
    private readonly signatureService: ClubPaymentCallbackSignatureService,
    private readonly decryptorService: SmsWechatCallbackDecryptorService,
  ) {
    this.directCredit = resolveSmsDirectCredit(configService);
    if (this.directCredit) {
      this.logger.warn(
        'SMS_RECHARGE_DIRECT_CREDIT 已开启：短信充值将跳过微信支付直接入账，' +
          '仅用于本地联调跑通流程。接入真支付前必须关闭，否则用户可无限免费充值。',
      );
    }
  }

  async createRechargeOrder(
    storeId: number,
    amountFen: number,
  ): Promise<SmsRechargeOrderResponseDto> {
    const orderNo = buildSmsOrderNo();
    const expiresAt = new Date(
      Date.now() + SMS_RECHARGE_ORDER_TTL_SECONDS * 1000,
    );

    await this.prisma.smsRechargeOrder.create({
      data: { orderNo, storeId, amountFen, expiresAt, status: 'pending' },
    });

    // 本地直充：对齐新客额度 writeRecharge（无外部支付单号，直接入账）。
    // 订单已是 paid，前端首次轮询即命中，契约与走微信时完全一致。
    if (this.directCredit) {
      await this.creditRecharge({
        orderNo,
        storeId,
        amountFen,
        // 本地单号，仅用于对账（微信真支付时这里是 transaction_id）
        transactionId: `DIRECT${storeId}${Date.now()}`,
      });

      return {
        orderNo,
        codeUrl: '',
        amountFen,
        expiresAt: expiresAt.toISOString(),
      };
    }

    try {
      const { codeUrl } = await this.nativeService.createNativeOrder({
        orderNo,
        amountFen,
        description: ORDER_DESCRIPTION,
      });

      await this.prisma.smsRechargeOrder.update({
        where: { orderNo },
        data: { codeUrl },
      });

      return {
        orderNo,
        codeUrl,
        amountFen,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      // 下单失败要落 failed，否则前端会一直轮询一个永远不会有结果的订单
      await this.prisma.smsRechargeOrder.update({
        where: { orderNo },
        data: { status: 'failed' },
      });
      throw error;
    }
  }

  /**
   * 轮询订单状态。**惰性关闭**：pending 且已过期时顺手置 closed，
   * 不额外起定时任务（定时任务在集群下还要处理选主与重复执行）。
   */
  async getRechargeOrderStatus(
    storeId: number,
    orderNo: string,
  ): Promise<SmsRechargeOrderStatusDto> {
    const order = await this.prisma.smsRechargeOrder.findUnique({
      where: { orderNo },
      select: { orderNo: true, storeId: true, status: true, expiresAt: true },
    });

    if (!order || order.storeId !== storeId) {
      throw new NotFoundException('充值订单不存在');
    }

    if (order.status === 'pending' && order.expiresAt.getTime() <= Date.now()) {
      await this.prisma.smsRechargeOrder.update({
        where: { orderNo },
        data: { status: 'closed' },
      });
      return { orderNo, status: 'closed' };
    }

    return { orderNo, status: order.status };
  }

  /**
   * 处理微信支付回调。
   *
   * ⚠️ 这是**独立**的短信钱包回调，不复用 `/api/club/payments/wechat/callback`
   * （那是 C 端 club 订单上下文）。验签与解密复用现有实现，落账逻辑独立。
   */
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
      await this.markOrderFailed(orderNo);
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

    const paidAmountFen = transaction.amount?.total ?? order.amountFen;
    if (paidAmountFen !== order.amountFen) {
      this.logger.warn(
        `短信充值金额不一致：orderNo=${orderNo}，订单 ${order.amountFen} 分，回调 ${paidAmountFen} 分，按订单金额入账`,
      );
    }

    const credited = await this.creditRecharge({
      orderNo,
      storeId: order.storeId,
      amountFen: order.amountFen,
      transactionId: transaction.transaction_id,
    });

    return {
      success: true,
      orderNo,
      status: 'paid',
      message: credited ? '充值已入账' : '重复回调，已忽略',
    };
  }

  // ─── 入账 ──────────────────────────────────────────────────────────────────

  /** @returns true 表示本次真正入账；false 表示重复回调已忽略 */
  async creditRecharge(params: {
    orderNo: string;
    storeId: number;
    amountFen: number;
    transactionId?: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.smsRechargeOrder.updateMany({
        where: { orderNo: params.orderNo, status: { not: 'paid' } },
        data: {
          status: 'paid',
          transactionId: params.transactionId ?? null,
          paidAt: new Date(),
        },
      });

      // count === 0 说明这笔订单此前已入账（微信重复投递）
      if (updated.count === 0) {
        return false;
      }

      await this.accountService.ensureAccount(tx, params.storeId);

      const account = await tx.storeSmsAccount.update({
        where: { storeId: params.storeId },
        data: {
          balanceFen: { increment: params.amountFen },
          totalRechargedFen: { increment: params.amountFen },
        },
        select: { balanceFen: true },
      });

      await tx.smsWalletLog.create({
        data: {
          storeId: params.storeId,
          type: 'recharge',
          changeFen: params.amountFen,
          balanceAfterFen: account.balanceFen,
          description: `微信充值 ${formatFenAmountDisplay(params.amountFen)}`,
          orderNo: params.orderNo,
        },
      });

      this.logger.log(
        `短信钱包入账：orderNo=${params.orderNo}，storeId=${params.storeId}，${params.amountFen} 分`,
      );

      return true;
    });
  }

  private async markOrderFailed(orderNo: string): Promise<void> {
    try {
      await this.prisma.smsRechargeOrder.updateMany({
        where: { orderNo, status: 'pending' },
        data: { status: 'failed' },
      });
    } catch (error) {
      // 订单可能根本不存在（订单号前缀校验已过，但库里没有），不应影响回调应答
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        this.logger.warn(
          `标记充值订单失败状态异常：orderNo=${orderNo}，${error.message}`,
        );
        return;
      }
      throw error;
    }
  }
}
