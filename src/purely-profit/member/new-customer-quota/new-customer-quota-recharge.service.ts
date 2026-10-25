// 新用户额度充值支付：下单（测试模式直接入账 / 真实模式换 codeUrl）、回调入账、轮询
//
// 与 `NewCustomerQuotaService.recharge` 的关系：
// 老方法保留为「无支付环节的历史路径」（测试模式下继续走它，行为不变），
// 本服务负责真实支付场景——支付单只管钱，额度入账复用同一段事务体 `writeRecharge`，
// 保证「余额 + 流水」的自洽规则只有一处实现。
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformPaymentOrderService } from '../../payments/platform-payment-order.service';
import { PlatformPaymentQrCodeService } from '../../payments/platform-payment-qrcode.service';
import { PlatformWechatNativeService } from '../../payments/platform-wechat-native.service';
import { ProfitPaymentModeService } from '../../payments/profit-payment-mode.service';
import { NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD } from './new-customer-quota.constants';
import {
  calcQuotaByAmountFen,
  isAllowedRechargeTier,
} from './new-customer-quota.domain';
import { readQuotaTotals } from './new-customer-quota.query';
import type { NewCustomerQuotaOverview } from './new-customer-quota.types';
import { writeRecharge } from './new-customer-quota.write';

const BIZ_TYPE = 'new_customer_quota';
/** 测试模式下的入账凭证：不能伪造微信流水号，用可识别的前缀表明来源 */
const MANUAL_TRANSACTION_PREFIX = 'manual-test';

export interface CreateQuotaRechargeOrderParams {
  storeId: number;
  operatorUserId: number;
  /** 充值档位金额（分），由后端档位表校验 */
  amountFen: number;
}

export interface QuotaRechargeOrderResult {
  /** 本次落单的支付模式 */
  mode: 'test' | 'live';
  /** 支付单号 */
  orderNo: string;
  /** 测试模式：直接返回最新概览 */
  overview?: NewCustomerQuotaOverview;
  /** 真实模式：二维码链接与轮询所需字段 */
  codeUrl?: string;
  /** 真实模式：由 codeUrl 渲染出的 PNG data URL（前端 <img> 只能加载这个） */
  qrCodeImageUrl?: string;
  amountFen?: number;
  expiresAt?: Date;
}

@Injectable()
export class NewCustomerQuotaRechargeService {
  private readonly logger = new Logger(NewCustomerQuotaRechargeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly paymentModeService: ProfitPaymentModeService,
    private readonly paymentOrderService: PlatformPaymentOrderService,
    private readonly nativeService: PlatformWechatNativeService,
    private readonly qrCodeService: PlatformPaymentQrCodeService,
  ) {}

  /** 创建额度充值支付单 */
  async createRechargeOrder(
    params: CreateQuotaRechargeOrderParams,
  ): Promise<QuotaRechargeOrderResult> {
    if (!isAllowedRechargeTier(params.amountFen)) {
      throw new ConflictException('充值档位不合法');
    }

    const skipPayment = await this.paymentModeService.isSkipPaymentAllowed();
    const mode = skipPayment ? 'test' : 'live';

    const order = await this.paymentOrderService.createOrder({
      bizType: BIZ_TYPE,
      storeId: params.storeId,
      operatorUserId: params.operatorUserId,
      amountFen: params.amountFen,
      payMode: mode,
    });

    if (skipPayment) {
      // 直接用刚创建的支付单入账，省掉一次「刚写完再查回来」的往返
      await this.settleOrder(
        order,
        `${MANUAL_TRANSACTION_PREFIX}-${order.orderNo}`,
        params.amountFen,
      );
      this.logger.warn(
        `[额度充值] 测试模式直接入账 orderNo=${order.orderNo} storeId=${params.storeId} amountFen=${params.amountFen}`,
      );
      return {
        mode,
        orderNo: order.orderNo,
        overview: await this.getOverview(params.storeId),
      };
    }

    return this.attachNativeCodeUrl(order);
  }

  /**
   * 回调 / 测试模式入账：校验金额后叠加额度。
   *
   * 幂等由支付单的「带状态条件更新」保证：重复回调不会重复加额度。
   */
  async settleByOrderNo(params: {
    orderNo: string;
    transactionId: string;
    amountFen: number;
  }): Promise<void> {
    const order = await this.paymentOrderService.findByOrderNo(params.orderNo);
    if (!order) {
      throw new ConflictException('支付单不存在');
    }

    await this.settleOrder(order, params.transactionId, params.amountFen);
  }

  /** 校验金额后入账：幂等由支付单的「带状态条件更新」保证 */
  private async settleOrder(
    order: { orderNo: string; storeId: number; amountFen: number },
    transactionId: string,
    amountFen: number,
  ): Promise<void> {
    // 资金安全：金额必须与落单金额一致，否则说明报文被篡改或串单
    if (order.amountFen !== amountFen) {
      this.logger.error(
        `[额度充值] 支付单 ${order.orderNo} 金额不一致：落单 ${order.amountFen} 分，入账 ${amountFen} 分，已拒绝入账`,
      );
      throw new ConflictException('支付金额与订单金额不一致，已拒绝入账');
    }

    await this.paymentOrderService.settleWithBusinessWrite(
      order.orderNo,
      transactionId,
      (tx) =>
        writeRecharge(tx, {
          storeId: order.storeId,
          amountFen,
          quotaCount: calcQuotaByAmountFen(amountFen),
          orderId: order.orderNo,
        }),
    );
  }

  /** 真实模式：换取微信二维码并挂到支付单上 */
  private async attachNativeCodeUrl(order: {
    orderNo: string;
    amountFen: number;
    expiresAt: Date;
  }): Promise<QuotaRechargeOrderResult> {
    try {
      const { codeUrl } = await this.nativeService.createNativeOrder({
        orderNo: order.orderNo,
        amountFen: order.amountFen,
        description: '新客额度充值',
        notifyUrl: this.getPlatformNotifyUrl(),
      });

      await this.paymentOrderService.attachCodeUrl(order.orderNo, codeUrl);

      return {
        mode: 'live',
        orderNo: order.orderNo,
        codeUrl,
        // weixin:// 协议串无法被 <img> 直接加载，必须同时给出可展示的图
        qrCodeImageUrl: await this.qrCodeService.renderPaymentQrCode(codeUrl),
        amountFen: order.amountFen,
        expiresAt: order.expiresAt,
      };
    } catch (error: unknown) {
      // 下单失败要留下痕迹：支付单置 failed，避免残留一张永远不会被关掉的 pending 单
      await this.paymentOrderService.markFailed(order.orderNo);
      throw error;
    }
  }

  /** 轮询支付单状态（超时惰性置 closed） */
  async getRechargeStatus(
    orderNo: string,
  ): Promise<{ status: string; paidAt: Date | null }> {
    return this.paymentOrderService.getStatus(orderNo);
  }

  /** 额度概览（与 NewCustomerQuotaService.getOverview 同口径） */
  async getOverview(storeId: number): Promise<NewCustomerQuotaOverview> {
    const totals = await readQuotaTotals(this.prisma, storeId);
    return {
      storeId,
      warningThreshold: NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
      ...totals,
    };
  }

  /**
   * 平台收款统一回调地址。
   *
   * 不回落到短信 / club 的回调地址：不同链路的回调互相不认识对方的单号，
   * 打错地方会表现为「用户已付款、额度没到账」且无任何报错。
   */
  private getPlatformNotifyUrl(): string {
    const configured = this.configService
      .get<string>('profit.wechatPayNotifyUrl')
      ?.trim();
    if (configured) {
      return configured;
    }
    throw new InternalServerErrorException(
      '环境变量 PROFIT_WECHAT_PAY_NOTIFY_URL 未配置，无法发起平台收款',
    );
  }
}
