import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SmsAccountService } from './sms-account.service';
import { SmsWechatNativeService } from './sms-wechat-native.service';
import { PlatformPaymentQrCodeService } from '../../payments/platform-payment-qrcode.service';
import { ProfitPaymentModeService } from '../../payments/profit-payment-mode.service';
import { PlatformPaymentRealtimeService } from '../../payments/platform-payment-realtime.service';
import type { ProfitPaymentMode } from '../../payments/profit-payment-mode.constants';
import { SMS_RECHARGE_ORDER_TTL_SECONDS } from './sms.constants';
import type {
  SmsRechargeOrderResponseDto,
  SmsRechargeOrderStatusDto,
} from './dto/sms.dto';
import { buildSmsOrderNo, formatFenAmountDisplay } from './sms.utils';

/** 微信下单描述文案（微信限制 127 字符内） */
const ORDER_DESCRIPTION = '短信钱包充值';

/**
 * 短信钱包充值服务：下单、轮询状态、入账。
 *
 * 回调验签/解密/金额核对在 `SmsRechargeCallbackService`，本类只提供
 * 「下单 → 出码 → 惰性关单」和「真正加钱」两件事，避免单文件过长难审。
 *
 * 入账的两个铁律：
 * 1. **只有 status !== 'paid' 才入账**——微信会重复投递同一笔回调；
 * 2. 用条件更新（`where status != paid`）而非「先读后写」，
 *    否则并发的两次回调会各自读到 pending 并重复加钱。
 */
@Injectable()
export class SmsRechargeService {
  private readonly logger = new Logger(SmsRechargeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: SmsAccountService,
    private readonly nativeService: SmsWechatNativeService,
    private readonly qrCodeService: PlatformPaymentQrCodeService,
    private readonly paymentModeService: ProfitPaymentModeService,
    private readonly realtimeService: PlatformPaymentRealtimeService,
  ) {}

  /**
   * 本次充值是否跳过微信支付、直接入账。
   *
   * **唯一裁决方是商家端全局支付模式**：短信链路历史上另有一个独立直充开关，
   * 与全局模式「取或」，会出现「全局已切真实支付、短信仍在白送」。
   * 生产环境 `isSkipPaymentAllowed()` 恒为 false，前端无法单独切换。
   */
  private async resolvePayMode(): Promise<ProfitPaymentMode> {
    return (await this.paymentModeService.isSkipPaymentAllowed())
      ? 'test'
      : 'live';
  }

  /**
   * 充值金额合法性：必须命中**后端下发的充值档位**。
   *
   * 金额计算权归后端，前端传来的 `amountFen` 只能当「选了哪一档」的标识，
   * 不能当权威金额：否则客户端可以构造任意金额下单（含 1 分钱刷流水、
   * 超大金额触发风控），回调对账也没有可比对的基准。
   */
  private assertConfiguredTierAmount(amountFen: number): number {
    const tiers = this.accountService
      .resolveRechargeTiers()
      .map((tier) => tier.amountFen);

    if (!Number.isInteger(amountFen) || !tiers.includes(amountFen)) {
      throw new BadRequestException('充值金额必须是后端下发的充值档位');
    }

    return amountFen;
  }

  async createRechargeOrder(
    storeId: number,
    amountFen: number,
  ): Promise<SmsRechargeOrderResponseDto> {
    const tierAmountFen = this.assertConfiguredTierAmount(amountFen);
    const payMode = await this.resolvePayMode();
    const orderNo = buildSmsOrderNo();
    const expiresAt = new Date(
      Date.now() + SMS_RECHARGE_ORDER_TTL_SECONDS * 1000,
    );

    await this.prisma.smsRechargeOrder.create({
      data: {
        orderNo,
        storeId,
        amountFen: tierAmountFen,
        expiresAt,
        status: 'pending',
        payMode,
      },
    });

    // 测试模式：对齐新客额度 writeRecharge（无外部支付单号，直接入账）。
    // 响应里显式回传 paid，前端不必先渲染二维码再等轮询才发现已到账。
    if (payMode === 'test') {
      await this.creditRecharge({
        orderNo,
        storeId,
        amountFen: tierAmountFen,
        payMode,
        // 本地单号，仅用于对账（微信真支付时这里是 transaction_id）
        transactionId: `DIRECT${storeId}${Date.now()}`,
      });

      return {
        orderNo,
        status: 'paid',
        codeUrl: '',
        qrCodeImageUrl: '',
        amountFen: tierAmountFen,
        expiresAt: expiresAt.toISOString(),
      };
    }

    // 微信侧订单一旦创建成功，后续任何一步失败都必须把它关掉：
    // 用户拿不到二维码不会付款，但微信侧订单仍可支付（2 小时有效），
    // 只把本地单标 failed 会留下「本地失败、微信仍可支付」的悬空订单。
    let wechatOrderCreated = false;

    try {
      const { codeUrl } = await this.nativeService.createNativeOrder({
        orderNo,
        amountFen: tierAmountFen,
        description: ORDER_DESCRIPTION,
      });
      wechatOrderCreated = true;

      await this.prisma.smsRechargeOrder.update({
        where: { orderNo },
        data: { codeUrl },
      });

      return {
        orderNo,
        status: 'pending',
        codeUrl,
        qrCodeImageUrl: await this.qrCodeService.renderPaymentQrCode(codeUrl),
        amountFen: tierAmountFen,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      if (wechatOrderCreated) {
        this.logger.error(
          `短信充值下单后续步骤失败，回滚微信订单：orderNo=${orderNo}`,
        );
        this.logger.debug(String(error));
        // 关单失败不覆盖原始错误：调用方需要看到真正的失败原因
        await this.closeWechatOrderSafely(orderNo, true);
      }

      // 落 failed，否则前端会一直轮询一个永远不会有结果的订单
      await this.markOrderFailed(orderNo);
      throw error;
    }
  }

  /**
   * 轮询订单状态。**惰性关闭**：pending 且已过期时顺手置 closed，
   * 不额外起定时任务（定时任务在集群下还要处理选主与重复执行）。
   *
   * 关本地单之前必须先关微信单，否则用户在「本地已过期」到「微信二维码失效」
   * 之间扫码仍能付款，出现前端提示已关单、钱却被扣走。
   */
  async getRechargeOrderStatus(
    storeId: number,
    orderNo: string,
  ): Promise<SmsRechargeOrderStatusDto> {
    const order = await this.prisma.smsRechargeOrder.findUnique({
      where: { orderNo },
      select: {
        orderNo: true,
        storeId: true,
        status: true,
        expiresAt: true,
        codeUrl: true,
      },
    });

    if (!order || order.storeId !== storeId) {
      throw new NotFoundException('充值订单不存在');
    }

    if (order.status === 'pending' && order.expiresAt.getTime() <= Date.now()) {
      const closeResult = await this.closeWechatOrderSafely(
        orderNo,
        Boolean(order.codeUrl),
      );

      // 微信侧已支付或关单结果未知：本地绝不能关，保持 pending 等回调/重试
      if (closeResult !== 'closed') {
        return { orderNo, status: 'pending' };
      }

      // 条件关单：上面读到的 pending 可能在这几毫秒内已被支付回调改成 paid。
      // 无条件 update 会把 paid 覆盖回 closed，出现「钱扣了、单关了」。
      const closed = await this.prisma.smsRechargeOrder.updateMany({
        where: { orderNo, status: 'pending' },
        data: { status: 'closed' },
      });

      if (closed.count === 0) {
        // 关单失败说明状态已变（多半是已支付），按最新状态返回，不能再写 closed。
        // 这里也**不能**推 closed：与真实终态冲突，会让用户刚看到「支付成功」又收到「已关闭」。
        const latest = await this.prisma.smsRechargeOrder.findUnique({
          where: { orderNo },
          select: { status: true },
        });
        return { orderNo, status: latest?.status ?? 'pending' };
      }

      // 全仓 purely-profit 只有 operations 下有定时任务，支付侧没有定时关单；
      // 前端不再轮询后，这次查单就是 closed 推送的唯一触发源，必须推。
      this.realtimeService.publishClosed(orderNo);

      return { orderNo, status: 'closed' };
    }

    return { orderNo, status: order.status };
  }

  /**
   * 关闭微信侧订单，失败不向上抛。
   *
   * @returns `closed` 可安全关本地单；`paid` 用户其实已付款；`unknown` 关单失败
   */
  private async closeWechatOrderSafely(
    orderNo: string,
    hasWechatOrder: boolean,
  ): Promise<'closed' | 'paid' | 'unknown'> {
    // 直充 / 下单未成功过：微信侧根本没有可支付的单
    if (!hasWechatOrder) {
      return 'closed';
    }

    try {
      return await this.nativeService.closeNativeOrder(orderNo);
    } catch (error) {
      this.logger.error(
        `关闭微信订单失败，本地保持 pending 等待回调：orderNo=${orderNo}`,
      );
      this.logger.debug(String(error));
      return 'unknown';
    }
  }

  // ─── 入账 ──────────────────────────────────────────────────────────────────

  /** @returns true 表示本次真正入账；false 表示重复回调已忽略 */
  async creditRecharge(params: {
    orderNo: string;
    storeId: number;
    amountFen: number;
    payMode: ProfitPaymentMode;
    transactionId?: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.smsRechargeOrder.updateMany({
        where: { orderNo: params.orderNo, status: { not: 'paid' } },
        data: {
          status: 'paid',
          payMode: params.payMode,
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
          payMode: params.payMode,
          changeFen: params.amountFen,
          balanceAfterFen: account.balanceFen,
          // 测试模式的充值不来自微信，流水说明必须能一眼区分，
          // 否则报表 / 人工对账会把白送的余额当成真实收款
          description: `${this.formatRechargeLabel(params.payMode)} ${formatFenAmountDisplay(params.amountFen)}`,
          orderNo: params.orderNo,
        },
      });

      this.logger.log(
        `短信钱包入账：orderNo=${params.orderNo}，storeId=${params.storeId}，${params.amountFen} 分，payMode=${params.payMode}`,
      );

      return true;
    });
  }

  private formatRechargeLabel(payMode: ProfitPaymentMode): string {
    return payMode === 'test' ? '测试充值' : '微信充值';
  }

  /**
   * 把订单标记为失败；更新异常时只告警，不影响调用方流程。
   *
   * @returns true 表示本次真的把 pending 改成了 failed；false 表示订单已不是 pending
   * （多半已被支付回调置 paid），调用方据此决定是否推送 failed——
   * 底层是 `updateMany where status='pending'`，订单已 paid 时不会改动任何行但仍会返回，
   * 无条件推 failed 会让用户刚收到「支付成功」就又收到「支付失败」。
   */
  async markOrderFailed(orderNo: string): Promise<boolean> {
    try {
      const updated = await this.prisma.smsRechargeOrder.updateMany({
        where: { orderNo, status: 'pending' },
        data: { status: 'failed' },
      });
      return updated.count > 0;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        this.logger.warn(
          `标记充值订单失败状态异常：orderNo=${orderNo}，${error.message}`,
        );
        return false;
      }
      throw error;
    }
  }
}
