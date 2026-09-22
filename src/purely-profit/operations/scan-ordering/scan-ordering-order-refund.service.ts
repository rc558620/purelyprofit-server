import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createScanOrderingSystemUser } from '../../../purely-club/scan-ordering/scan-ordering-sale-order-bridge.service';
import { ScanOrderingOrderRefundBalanceService } from './scan-ordering-order-refund-balance.service';
import { ScanOrderingOrderRejectService } from './scan-ordering-order-reject.service';
import { ScanOrderingOrderRefundWechatService } from './scan-ordering-order-refund-wechat.service';
import { ScanOrderingRefundTransitionService } from './scan-ordering-refund-transition.service';
import { ScanOrderingRefundRealtimeService } from './scan-ordering-refund-realtime.service';
import type {
  RefundProviderInfo,
  SystemTimeoutRefundInput,
} from './scan-ordering-refund.types';

/**
 * 商家扫码点餐订单退款处理服务。
 *
 * 作为退款流程编排入口：解析门店权限后按场景分流到
 * 商家拒单（ScanOrderingOrderRejectService）、微信自动退款
 * （ScanOrderingOrderRefundWechatService）与余额原路退款，
 * 订单状态流转与实时推送分别由状态流转服务与推送服务承担。
 */
@Injectable()
export class ScanOrderingOrderRefundHandlingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly balanceRefundService: ScanOrderingOrderRefundBalanceService,
    private readonly rejectService: ScanOrderingOrderRejectService,
    private readonly wechatRefundService: ScanOrderingOrderRefundWechatService,
    private readonly transitionService: ScanOrderingRefundTransitionService,
    private readonly realtimeService: ScanOrderingRefundRealtimeService,
  ) {}

  /** 拒绝待接单订单：已支付订单进入退款流程，未支付订单直接关闭。 */
  async rejectOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    const storeId = await this.resolveRefundStoreId(user);
    await this.rejectService.dispatchRejectFlow({
      user,
      orderId,
      storeId,
      version,
      reason,
    });
  }

  /** 确认拒单退款完成：置状态、归还库存、冲销销售单并推送事件。 */
  async completeRefund(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    provider?: RefundProviderInfo,
  ): Promise<void> {
    const storeId = await this.resolveRefundStoreId(user);
    const updated = await this.prisma.$transaction((tx) =>
      this.transitionService.completeRefund(tx, {
        orderId,
        storeId,
        version,
        operatorId: user.id,
        operatorType: 'merchant',
        provider,
      }),
    );
    if (updated) this.realtimeService.publishRefundCompleted(updated);
  }

  /**
   * 系统超时自动退款（待接单超时 / 制作中超时）：按支付渠道分流。
   * - 余额支付：余额原路退回 + 积分返还（全自动）；
   * - 微信支付：调用微信退款 API 全自动原路退回，失败降级为人工确认兜底；
   * - 未支付（理论不会出现）：直接置拒绝并释放预留库存。
   * 手工补录单不参与自动超时退款（由 autoCloseManualEntryByTimeout 单独处理），直接跳过。
   */
  async autoRefundByTimeout(input: SystemTimeoutRefundInput): Promise<void> {
    const order = await this.findTimeoutRefundableOrder(input);
    if (!order || order.manualEntry) return;
    if (order.paymentStatus !== 'paid') {
      await this.rejectService.rejectUnpaidOrder(
        {
          user: createScanOrderingSystemUser(),
          orderId: input.orderId,
          storeId: input.storeId,
          version: input.version,
          reason: input.reason,
        },
        input.fromStatus,
        'system',
      );
      return;
    }
    const attempt = order.paymentAttempts[0] ?? null;
    if (attempt?.paymentChannel === 'marketing_balance') {
      const updated = await this.balanceRefundService.refund(
        {
          orderId: input.orderId,
          storeId: input.storeId,
          version: input.version,
          reason: input.reason,
          fromStatus: input.fromStatus,
        },
        createScanOrderingSystemUser(),
        'system',
      );
      this.realtimeService.publishRefundCompleted(updated);
      return;
    }
    await this.wechatRefundService.initiateAutoWechatRefund({
      ...input,
      paidAmount: order.paidAmount,
      paymentAttempt: attempt,
    });
  }

  /**
   * 系统超时关闭手工补录单：与商家拒单同链路（置拒绝 + 释放预留库存 +
   * 创建退款记账记录），但**不触发任何真实退款**——手工单已收款，
   * 真实退款由商家线下自行处理，系统仅保证交班/销售记录账务展示一致。
   */
  async autoCloseManualEntryByTimeout(
    input: SystemTimeoutRefundInput,
  ): Promise<void> {
    const order = await this.prisma.scanOrders.findFirst({
      where: {
        id: input.orderId,
        storeId: input.storeId,
        status: input.fromStatus,
        manualEntry: true,
      },
      select: { id: true },
    });
    if (!order) return;
    await this.rejectService.closeManualEntryOrder(
      {
        user: createScanOrderingSystemUser(),
        orderId: input.orderId,
        storeId: input.storeId,
        version: input.version,
        reason: input.reason,
      },
      input.fromStatus,
      'system',
    );
  }

  /** 重试退款中订单：复用原退款单号，避免第三方重复生成退款单。 */
  async retryAutoWechatRefund(input: {
    orderId: number;
    storeId: number;
    version: number;
    refundNo: string;
    retryCount: number;
    maxRetries: number;
  }): Promise<void> {
    await this.wechatRefundService.retryAutoWechatRefund(input);
  }

  /** 查询待系统超时退款的订单（含最近一次成功支付尝试）。 */
  private findTimeoutRefundableOrder(input: SystemTimeoutRefundInput) {
    return this.prisma.scanOrders.findFirst({
      where: {
        id: input.orderId,
        storeId: input.storeId,
        status: input.fromStatus,
      },
      select: {
        id: true,
        paymentStatus: true,
        paidAmount: true,
        manualEntry: true,
        paymentAttempts: {
          where: { status: 'succeeded' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            paymentChannel: true,
            merchantPaymentNo: true,
            providerTransactionId: true,
          },
        },
      },
    });
  }

  /** 解析当前商家门店并校验拒单退款权限。 */
  private resolveRefundStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权操作扫码点餐订单',
    );
  }
}
