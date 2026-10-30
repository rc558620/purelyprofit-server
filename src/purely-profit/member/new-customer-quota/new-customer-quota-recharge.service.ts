// 新用户额度充值支付：下单（测试模式直接入账 / 真实模式换 codeUrl）、回调入账、轮询
//
// 支付单只管钱（`PlatformPaymentOrderService`），额度入账统一走 `writeRecharge`，
// 保证「余额 + 流水」的自洽规则只有一处实现。
// 测试模式与真实模式走的是同一条入账链路，只靠支付单上的 payMode 区分，没有第二条旁路。
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
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
/**
 * 测试模式的重复提交判定窗口。
 *
 * 真实模式靠「待支付单未过期就复用」天然挡住连点；测试模式下单即生效，
 * 没有待支付态可复用，必须靠时间窗 + 同门店同档位把连点 / 网络重试收成一次。
 */
const TEST_MODE_DEDUP_WINDOW_MS = 30 * 1000;

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

    if (skipPayment) {
      // 测试模式下单即生效，没有「待支付单复用」这层天然去重：
      // 连点 / 网络重试会各落一笔单、各加一次额度。窗口内同门店同档位视为同一次操作。
      const duplicated = await this.findRecentTestOrder(
        params.storeId,
        params.amountFen,
      );
      if (duplicated) {
        this.logger.warn(
          `[额度充值] 测试模式重复提交已忽略 orderNo=${duplicated} storeId=${params.storeId} amountFen=${params.amountFen}`,
        );
        return {
          mode,
          orderNo: duplicated,
          overview: await this.getOverview(params.storeId),
        };
      }
    }

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

  /** 校验业务类型与金额后入账：幂等由支付单的「带状态条件更新」保证 */
  private async settleOrder(
    order: {
      orderNo: string;
      bizType: string;
      storeId: number;
      amountFen: number;
      payMode: string;
    },
    transactionId: string,
    amountFen: number,
  ): Promise<void> {
    // 资金安全：回调分发虽然已按业务类型分流，这里再挡一次，避免串业务入账
    if (order.bizType !== BIZ_TYPE) {
      this.logger.error(
        `[额度充值] 支付单 ${order.orderNo} 业务类型为 ${order.bizType}，不是额度充值单，已拒绝入账`,
      );
      throw new ConflictException('支付单业务类型不匹配，已拒绝入账');
    }

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
          payMode: order.payMode === 'test' ? 'test' : 'live',
        }),
    );
  }

  /** 真实模式：换取微信二维码并挂到支付单上 */
  private async attachNativeCodeUrl(order: {
    orderNo: string;
    amountFen: number;
    expiresAt: Date;
  }): Promise<QuotaRechargeOrderResult> {
    // 微信单一旦创建成功，后续任何一步（含二维码出图）失败都必须把它关掉：
    // 微信侧二维码 2 小时有效，只把本地单标 failed 会留下「本地失败、微信仍可支付」的悬空单
    let wechatOrderCreated = false;

    try {
      const { codeUrl } = await this.nativeService.createNativeOrder({
        orderNo: order.orderNo,
        amountFen: order.amountFen,
        description: '新客额度充值',
        notifyUrl: this.getPlatformNotifyUrl(),
        bizType: 'new_customer_quota',
      });
      wechatOrderCreated = true;

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
      if (wechatOrderCreated) {
        // 关单失败只记日志，不能覆盖下面要抛出的原始错误
        await this.paymentOrderService.closeWechatOrderQuietly(
          order.orderNo,
          'new_customer_quota',
        );
      }

      // 下单失败要留下痕迹：支付单置 failed，避免残留一张永远不会被关掉的 pending 单
      await this.paymentOrderService.markFailed(order.orderNo);
      throw error;
    }
  }

  /**
   * 轮询支付单状态（超时惰性置 closed）。
   *
   * 必须带上门店归属：单号一旦泄漏（日志、截图、转发），没有归属校验就等于
   * 把任意门店的支付状态开放给所有持营销权限的账号，还会顺手替别人把单关掉。
   */
  async getRechargeStatus(
    orderNo: string,
    storeId: number,
  ): Promise<{ status: string; paidAt: Date | null }> {
    const order = await this.paymentOrderService.findByOrderNo(orderNo);

    if (!order || order.storeId !== storeId || order.bizType !== BIZ_TYPE) {
      // 统一按「不存在」处理，避免通过错误文案反向探测别人的单号
      throw new NotFoundException('支付单不存在');
    }

    return this.paymentOrderService.getStatus(orderNo, storeId);
  }

  /** 查找窗口内同门店同档位的测试充值单（仅供测试模式去重使用） */
  private async findRecentTestOrder(
    storeId: number,
    amountFen: number,
  ): Promise<string | null> {
    const recent = await this.prisma.platformPaymentOrder.findFirst({
      where: {
        storeId,
        bizType: BIZ_TYPE,
        payMode: 'test',
        status: 'paid',
        amountFen,
        createdAt: { gte: new Date(Date.now() - TEST_MODE_DEDUP_WINDOW_MS) },
      },
      select: { orderNo: true },
      orderBy: { createdAt: 'desc' },
    });

    return recent?.orderNo ?? null;
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
