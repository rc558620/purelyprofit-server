import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScanOrderFulfillmentStatus, ScanOrderStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';
import { ScanOrderingOrderRefundBalanceService } from './scan-ordering-order-refund-balance.service';
import { ScanOrderingRefundStockRestoreService } from './scan-ordering-refund-stock-restore.service';
import { ScanOrderingRefundTransitionService } from './scan-ordering-refund-transition.service';
import { ScanOrderingRefundRealtimeService } from './scan-ordering-refund-realtime.service';
import type {
  MerchantRejectContext,
  MerchantRefundFlowContext,
} from './scan-ordering-refund.types';

/**
 * 扫码点餐商家拒单服务。
 *
 * 按支付状态与渠道分流：手工补录单直接关闭记账、未支付单直接关闭、
 * 余额支付原路退回、普通支付走退款任务流程，并负责库存释放与实时推送。
 */
@Injectable()
export class ScanOrderingOrderRejectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly refundService: ScanOrderingRefundService,
    private readonly balanceRefundService: ScanOrderingOrderRefundBalanceService,
    private readonly stockRestoreService: ScanOrderingRefundStockRestoreService,
    private readonly transitionService: ScanOrderingRefundTransitionService,
    private readonly realtimeService: ScanOrderingRefundRealtimeService,
  ) {}

  /** 按支付状态与渠道分流拒单：余额原路退款 / 退款任务 / 直接关闭。 */
  async dispatchRejectFlow(context: MerchantRejectContext): Promise<void> {
    const order = await this.findRejectableOrder(context);
    if (!order) throw new NotFoundException('扫码点餐订单不存在');
    // 手工补录单拒单：直接关闭（已收款请线下退还），同时创建 SaleOrder + 退款记录，
    // 使销售记录（sales-record）展示「已退款、利润¥0、金额+¥0、下单途径→支付方式」。
    if (order.manualEntry) {
      await this.closeManualEntryOrder(context);
      return;
    }
    if (order.paymentStatus !== 'paid') {
      await this.rejectUnpaidOrder(context);
      return;
    }
    const attempt = order.paymentAttempts[0] ?? null;
    const isProduction =
      this.configService.get<string>('nodeEnv') === 'production';
    if (attempt?.paymentChannel === 'marketing_balance' || !isProduction) {
      await this.refundMarketingBalanceOrder(context);
      return;
    }
    await this.initiateRefundFlow({
      ...context,
      paidAmount: order.paidAmount,
      paymentAttempt: attempt,
    });
  }

  /**
   * 手工补录单拒单/超时关闭：置 rejected + 释放预留库存 + 创建退款记账记录并推送。
   * 手工单已收款，真实退款由商家线下自行处理，系统仅保证账务展示一致。
   * @param fromStatus 订单当前状态（商家拒单为 pending_acceptance，系统超时可传 preparing）
   * @param operatorType 操作类型：merchant=商家 / system=系统超时自动关闭
   */
  async closeManualEntryOrder(
    context: MerchantRejectContext,
    fromStatus: ScanOrderStatus = ScanOrderStatus.pending_acceptance,
    operatorType = 'merchant',
  ): Promise<void> {
    const reason = `${context.reason}（手工录入单拒单，已收款项请线下退还）`;
    await this.prisma.$transaction(async (tx) => {
      // 置为 rejected + 释放预留库存（对应 rejectUnpaidOrder 的核心逻辑）
      const result = await tx.scanOrders.updateMany({
        where: {
          id: context.orderId,
          storeId: context.storeId,
          status: fromStatus,
          version: context.version,
        },
        data: {
          status: ScanOrderStatus.rejected,
          fulfillmentStatus: ScanOrderFulfillmentStatus.closed,
          version: { increment: 1 },
          rejectReason: reason,
        },
      });
      if (result.count === 0) {
        throw new ConflictException('订单状态已变化，请刷新后重试');
      }
      await this.stockRestoreService.restoreReservedStock(tx, context.orderId);
      // 创建 SaleOrder（bridge 自动识别 manualEntry，从 metadata 取支付方式）并退款
      // 使销售记录中出现一条「已退款、利润¥0」的记录
      await this.stockRestoreService.refundSaleOrder(
        tx,
        context.orderId,
        context.user,
      );
      // 记录状态历史
      await this.transitionService.createOrderStatusHistoryInTransaction(
        tx,
        {
          orderId: context.orderId,
          storeId: context.storeId,
          version: context.version,
          fromStatus,
          toStatus: ScanOrderStatus.rejected,
          operatorId: context.user.id,
          reason,
        },
        operatorType,
      );
    });
    await this.realtimeService.publishOrderStatusAfterChange(context.orderId);
  }

  /** 拒绝未支付订单：置关闭状态、释放预留库存、记录历史并推送。
   * @param fromStatus 订单当前状态（商家拒单为 pending_acceptance，系统超时可传 preparing）。
   * @param operatorType 操作类型：merchant=商家 / system=系统超时自动关闭 */
  async rejectUnpaidOrder(
    context: MerchantRejectContext,
    fromStatus: ScanOrderStatus = ScanOrderStatus.pending_acceptance,
    operatorType = 'merchant',
  ): Promise<void> {
    const closed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.scanOrders.updateMany({
        where: {
          id: context.orderId,
          storeId: context.storeId,
          version: context.version,
          status: fromStatus,
        },
        data: {
          status: ScanOrderStatus.rejected,
          fulfillmentStatus: ScanOrderFulfillmentStatus.closed,
          version: { increment: 1 },
          rejectReason: context.reason,
        },
      });
      if (result.count === 0) return false;
      // 释放下单时的预留库存（未接单订单仅释放预留，不恢复已扣减库存）
      await this.stockRestoreService.restoreReservedStock(tx, context.orderId);
      await this.transitionService.createOrderStatusHistoryInTransaction(
        tx,
        {
          orderId: context.orderId,
          storeId: context.storeId,
          version: context.version,
          fromStatus,
          toStatus: ScanOrderStatus.rejected,
          reason: context.reason,
        },
        operatorType,
      );
      return true;
    });
    if (!closed) {
      throw new ConflictException('订单状态已变化，请刷新后重试');
    }
    await this.realtimeService.publishOrderStatusAfterChange(context.orderId);
  }

  /** 营销余额订单原路退款：委托余额退款服务并推送完成事件。 */
  private async refundMarketingBalanceOrder(
    context: MerchantRejectContext,
  ): Promise<void> {
    const { user, ...input } = context;
    const updated = await this.balanceRefundService.refund(input, user);
    this.realtimeService.publishRefundCompleted(updated);
  }

  /** 普通支付订单发起拒单退款：置退款中、记录历史、创建退款任务并推送。
   * 立即创建 SaleOrderRefund（独立事务），确保销售记录与交班页能展示退款。 */
  private async initiateRefundFlow(
    input: MerchantRefundFlowContext,
  ): Promise<void> {
    await this.transitionService.markOrderRefunding(input);
    await this.createMerchantRefundTask(input);
    // 立即创建 SaleOrderRefund（独立事务），不依赖后续 completeRefund 手动确认
    // 传入拒绝操作的商家账号：交班页操作员列展示主账号/店长/收银员
    await this.prisma.$transaction(async (tx) => {
      await this.stockRestoreService.refundSaleOrder(
        tx,
        input.orderId,
        input.user,
      );
    });
    await this.realtimeService.publishOrderStatusAfterChange(input.orderId);
  }

  /** 创建商家拒单退款任务。 */
  private async createMerchantRefundTask(
    input: MerchantRefundFlowContext,
  ): Promise<void> {
    const attempt = input.paymentAttempt;
    await this.refundService.createRefundTask({
      orderId: input.orderId,
      storeId: input.storeId,
      paymentAttemptId: attempt?.id ?? null,
      triggerType: 'merchant_reject',
      refundAmount: input.paidAmount,
      merchantPaymentNo: attempt?.merchantPaymentNo ?? null,
      providerTransactionId: attempt?.providerTransactionId ?? null,
      operatorType: 'merchant',
      operatorId: input.user.id,
      failureReason: `商家拒单：${input.reason}`,
    });
  }

  /** 查询待拒单订单（含最近一次成功支付尝试）。 */
  private findRejectableOrder(context: MerchantRejectContext) {
    return this.prisma.scanOrders.findFirst({
      where: { id: context.orderId, storeId: context.storeId },
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
}
