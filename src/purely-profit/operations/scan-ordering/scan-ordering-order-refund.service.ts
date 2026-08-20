import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ScanOrderCouponUsageStatus,
  ScanOrderFulfillmentStatus,
  ScanOrderPaymentAttemptStatus,
  ScanOrderPaymentStatus,
  ScanOrderStatus,
  type Prisma,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';
import { createScanOrderingSystemUser } from '../../../purely-club/scan-ordering/scan-ordering-sale-order-bridge.service';
import { ClubWechatRefundService } from '../../../purely-club/payments/club-wechat-refund.service';
import { ScanOrderingOrderRefundBalanceService } from './scan-ordering-order-refund-balance.service';
import { ScanOrderingRefundStockRestoreService } from './scan-ordering-refund-stock-restore.service';
import { ORDER_STATUS_SELECT } from './scan-ordering-refund.types';
import type {
  MerchantRejectContext,
  MerchantRefundFlowContext,
  OrderStatusHistoryInput,
  OrderStatusSnapshot,
  RefundFinalizeInput,
  RefundOrderTarget,
  RefundPaymentInfo,
  RefundProviderInfo,
  RefundedOrderSnapshot,
  RefundTransitionTarget,
  SystemTimeoutRefundInput,
} from './scan-ordering-refund.types';

/** 商家扫码点餐订单退款处理服务：拒单分流、退款完成闭环并推送实时事件。 */
@Injectable()
export class ScanOrderingOrderRefundHandlingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly refundService: ScanOrderingRefundService,
    private readonly balanceRefundService: ScanOrderingOrderRefundBalanceService,
    private readonly stockRestoreService: ScanOrderingRefundStockRestoreService,
    private readonly configService: ConfigService,
    private readonly wechatRefundService: ClubWechatRefundService,
  ) {}

  /** 拒绝待接单订单：已支付订单进入退款流程，未支付订单直接关闭。 */
  async rejectOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    const storeId = await this.resolveRefundStoreId(user);
    await this.dispatchRejectFlow({ user, orderId, storeId, version, reason });
  }

  /** 确认拒单退款完成：置状态、归还库存、冲销销售单并推送事件。 */
  async completeRefund(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    provider?: RefundProviderInfo,
  ): Promise<void> {
    const storeId = await this.resolveRefundStoreId(user);
    const target = { orderId, storeId, version };
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.markRefundCompleted(tx, target);
      await this.restoreOrderAfterRefund(tx, orderId);
      await this.finalizeRefundTask(tx, {
        ...target,
        operatorId: user.id,
        provider,
      });
      return this.loadRefundedOrder(tx, orderId);
    });
    if (updated) this.publishRefundCompleted(updated);
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
      await this.rejectUnpaidOrder(
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
      this.publishRefundCompleted(updated);
      return;
    }
    await this.initiateAutoWechatRefund({
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
    await this.closeManualEntryOrder(
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

  /** 系统超时微信退款：置退款中 → 建任务 → 调微信 API → 完成闭环。
   * 微信 API 调用失败时订单停留在退款中、任务为人工待处理，由商家确认兜底。 */
  private async initiateAutoWechatRefund(
    input: SystemTimeoutRefundInput & {
      paidAmount: number;
      paymentAttempt: RefundPaymentInfo | null;
    },
  ): Promise<void> {
    await this.markOrderRefunding(
      {
        orderId: input.orderId,
        storeId: input.storeId,
        version: input.version,
        reason: input.reason,
      },
      input.fromStatus,
    );
    const refundNo = await this.refundService.createRefundTask({
      orderId: input.orderId,
      storeId: input.storeId,
      paymentAttemptId: input.paymentAttempt?.id ?? null,
      triggerType: 'system_timeout',
      refundAmount: input.paidAmount,
      merchantPaymentNo: input.paymentAttempt?.merchantPaymentNo ?? null,
      providerTransactionId:
        input.paymentAttempt?.providerTransactionId ?? null,
      operatorType: 'system',
      failureReason: `系统超时自动退款：${input.reason}`,
    });
    // 微信原支付单号（out_trade_no）为支付尝试的商户单号；缺失时跳过 API 调用，
    // 保留任务为人工待处理，避免生产环境对无真实支付记录的订单误调退款。
    let provider: RefundProviderInfo | undefined;
    if (input.paymentAttempt?.merchantPaymentNo) {
      const { refundId } = await this.wechatRefundService.requestRefund({
        storeId: input.storeId,
        orderNo: input.paymentAttempt.merchantPaymentNo,
        refundNo,
        totalFen: input.paidAmount,
        refundFen: input.paidAmount,
        reason: input.reason,
      });
      provider = { refundNo, refundId };
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.markRefundCompleted(tx, {
        orderId: input.orderId,
        storeId: input.storeId,
        version: input.version,
      });
      await this.restoreOrderAfterRefund(tx, input.orderId);
      await this.finalizeRefundTask(tx, {
        orderId: input.orderId,
        storeId: input.storeId,
        version: input.version,
        operatorType: 'system',
        provider,
      });
      return this.loadRefundedOrder(tx, input.orderId);
    });
    if (updated) this.publishRefundCompleted(updated);
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

  /** 按支付状态与渠道分流拒单：余额原路退款 / 退款任务 / 直接关闭。 */
  private async dispatchRejectFlow(
    context: MerchantRejectContext,
  ): Promise<void> {
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

  /** 营销余额订单原路退款：委托余额退款服务并推送完成事件。 */
  private async refundMarketingBalanceOrder(
    context: MerchantRejectContext,
  ): Promise<void> {
    const { user, ...input } = context;
    const updated = await this.balanceRefundService.refund(input, user);
    this.publishRefundCompleted(updated);
  }

  /** 普通支付订单发起拒单退款：置退款中、记录历史、创建退款任务并推送。
   * 立即创建 SaleOrderRefund（独立事务），确保销售记录与交班页能展示退款。 */
  private async initiateRefundFlow(
    input: MerchantRefundFlowContext,
  ): Promise<void> {
    await this.markOrderRefunding(input);
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
    await this.publishOrderStatusAfterChange(input.orderId);
  }

  /**
   * 手工补录单拒单/超时关闭：置 rejected + 释放预留库存 + 创建退款记账记录并推送。
   * 手工单已收款，真实退款由商家线下自行处理，系统仅保证账务展示一致。
   * @param fromStatus 订单当前状态（商家拒单为 pending_acceptance，系统超时可传 preparing）
   * @param operatorType 操作类型：merchant=商家 / system=系统超时自动关闭
   */
  private async closeManualEntryOrder(
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
      await tx.scanOrderStatusHistory.create({
        data: {
          orderId: context.orderId,
          storeId: context.storeId,
          fromStatus,
          toStatus: ScanOrderStatus.rejected,
          operatorType,
          operatorId: context.user.id,
          reason,
        },
      });
    });
    await this.publishOrderStatusAfterChange(context.orderId);
  }
  /** 拒绝未支付订单：置关闭状态、释放预留库存、记录历史并推送。
   * @param fromStatus 订单当前状态（商家拒单为 pending_acceptance，系统超时可传 preparing）。
   * @param operatorType 操作类型：merchant=商家 / system=系统超时自动关闭 */
  private async rejectUnpaidOrder(
    context: MerchantRejectContext,
    fromStatus: ScanOrderStatus = ScanOrderStatus.pending_acceptance,
    operatorType = 'merchant',
  ): Promise<void> {
    const closed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.scanOrders.updateMany({
        where: this.pendingAcceptanceWhere(context, fromStatus),
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
      await this.createOrderStatusHistoryInTransaction(
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
    await this.publishOrderStatusAfterChange(context.orderId);
  }

  /** 乐观锁置订单为退款中并记录状态历史，冲突时抛异常。
   * @param fromStatus 订单当前状态（商家拒单为 pending_acceptance，系统超时可传 preparing）。 */
  private async markOrderRefunding(
    input: RefundTransitionTarget,
    fromStatus: ScanOrderStatus = ScanOrderStatus.pending_acceptance,
  ): Promise<void> {
    const result = await this.prisma.scanOrders.updateMany({
      where: this.pendingAcceptanceWhere(input, fromStatus),
      data: {
        status: ScanOrderStatus.refunding,
        paymentStatus: 'refunding',
        rejectReason: input.reason,
        version: { increment: 1 },
      },
    });
    if (result.count === 0)
      throw new ConflictException('订单状态已变化，请刷新后重试');
    await this.createOrderStatusHistory({
      orderId: input.orderId,
      storeId: input.storeId,
      version: input.version,
      fromStatus,
      toStatus: ScanOrderStatus.refunding,
      reason: input.reason,
    });
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

  /** 查询订单最新状态并推送状态变更事件。 */
  private async publishOrderStatusAfterChange(orderId: number): Promise<void> {
    const order = await this.prisma.scanOrders.findUnique({
      where: { id: orderId },
      select: ORDER_STATUS_SELECT,
    });
    if (order) this.publishOrderStatusChanged(order);
  }

  /** 事务内乐观锁更新订单为拒绝/已退款，冲突时给出幂等或状态变更提示。 */
  private async markRefundCompleted(
    tx: Prisma.TransactionClient,
    input: RefundOrderTarget,
  ): Promise<void> {
    const result = await tx.scanOrders.updateMany({
      where: {
        id: input.orderId,
        storeId: input.storeId,
        version: input.version,
        status: ScanOrderStatus.refunding,
        paymentStatus: ScanOrderPaymentStatus.refunding,
      },
      data: {
        status: ScanOrderStatus.rejected,
        paymentStatus: ScanOrderPaymentStatus.refunded,
        fulfillmentStatus: ScanOrderFulfillmentStatus.closed,
        version: { increment: 1 },
      },
    });
    if (result.count !== 0) return;
    const existing = await tx.scanOrders.findFirst({
      where: { id: input.orderId, storeId: input.storeId },
      select: { id: true, status: true, paymentStatus: true },
    });
    if (!existing) throw new NotFoundException('扫码点餐订单不存在');
    if (
      existing.status === ScanOrderStatus.rejected &&
      existing.paymentStatus === ScanOrderPaymentStatus.refunded
    ) {
      throw new ConflictException('订单退款已完成，请勿重复操作');
    }
    throw new ConflictException('订单状态已变化，请刷新后重试');
  }

  /** 事务内归还库存、冲销销售单并关闭支付尝试与优惠券占用。 */
  private async restoreOrderAfterRefund(
    tx: Prisma.TransactionClient,
    orderId: number,
  ): Promise<void> {
    await this.stockRestoreService.restoreReservedStock(tx, orderId);
    await this.stockRestoreService.refundSaleOrder(tx, orderId);
    await tx.scanOrderPaymentAttempt.updateMany({
      where: { orderId, status: ScanOrderPaymentAttemptStatus.succeeded },
      data: { status: ScanOrderPaymentAttemptStatus.refunded },
    });
    await tx.scanOrderCouponUsage.updateMany({
      where: {
        orderId,
        status: {
          in: [
            ScanOrderCouponUsageStatus.locked,
            ScanOrderCouponUsageStatus.consumed,
          ],
        },
      },
      data: { status: ScanOrderCouponUsageStatus.refunded },
    });
  }

  /** 事务内标记退款任务成功并写入状态历史。 */
  private async finalizeRefundTask(
    tx: Prisma.TransactionClient,
    input: RefundFinalizeInput,
  ): Promise<void> {
    await this.refundService.markRefundTaskSucceededInTransaction(tx, {
      orderId: input.orderId,
      providerRefundNo: input.provider?.refundNo ?? null,
      providerRefundId: input.provider?.refundId ?? null,
    });
    await this.createOrderStatusHistory(
      {
        orderId: input.orderId,
        storeId: input.storeId,
        version: input.version,
        fromStatus: ScanOrderStatus.refunding,
        toStatus: ScanOrderStatus.rejected,
        operatorId: input.operatorId,
        reason: '退款完成，订单已关闭',
      },
      input.operatorType ?? 'merchant',
    );
  }

  /** 查询退款完成后的订单快照（用于实时推送）。 */
  private loadRefundedOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
  ): Promise<RefundedOrderSnapshot | null> {
    return tx.scanOrders.findUnique({
      where: { id: orderId },
      select: {
        ...ORDER_STATUS_SELECT,
        pickupNumber: true,
        refundTasks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            refundSucceededAt: true,
            processedAt: true,
            triggeredAt: true,
          },
        },
      },
    });
  }

  /** 推送退款完成事件（含取餐号与退款完成时间）。 */
  private publishRefundCompleted(updated: RefundedOrderSnapshot): void {
    this.realtimeService.publishOrderStatusChanged({
      orderId: updated.id,
      storeId: updated.storeId,
      sessionId: updated.sessionId,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
      fulfillmentStatus: updated.fulfillmentStatus,
      pickupNumber: updated.pickupNumber,
      pickupNumberLabel:
        updated.pickupNumber == null
          ? null
          : String(updated.pickupNumber).padStart(3, '0'),
      refundSucceededAt:
        updated.refundTasks[0]?.refundSucceededAt?.toISOString() ??
        updated.refundTasks[0]?.processedAt?.toISOString() ??
        updated.refundTasks[0]?.triggeredAt?.toISOString() ??
        null,
    });
  }

  /** 推送简单状态变更事件。 */
  private publishOrderStatusChanged(order: OrderStatusSnapshot): void {
    this.realtimeService.publishOrderStatusChanged({
      orderId: order.id,
      storeId: order.storeId,
      sessionId: order.sessionId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
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

  /** 待接单订单乐观锁查询条件（fromStatus 支持系统超时的 preparing 场景）。 */
  private pendingAcceptanceWhere(
    input: RefundOrderTarget,
    fromStatus: ScanOrderStatus = ScanOrderStatus.pending_acceptance,
  ) {
    return {
      id: input.orderId,
      storeId: input.storeId,
      version: input.version,
      status: fromStatus,
    };
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

  /** 写入操作订单状态历史。
   * @param operatorType 操作类型：merchant=商家 / system=系统超时自动退款 */
  private createOrderStatusHistory(
    input: OrderStatusHistoryInput,
    operatorType = 'merchant',
  ): Promise<unknown> {
    // version 仅用于乐观锁校验，ScanOrderStatusHistory 无该字段，写入前剥离
    const { version: _version, ...historyInput } = input;
    return this.prisma.scanOrderStatusHistory.create({
      data: {
        ...historyInput,
        operatorType,
      },
    });
  }

  /** 事务内写入操作订单状态历史。
   * @param operatorType 操作类型：merchant=商家 / system=系统超时自动退款 */
  private createOrderStatusHistoryInTransaction(
    tx: Prisma.TransactionClient,
    input: OrderStatusHistoryInput,
    operatorType = 'merchant',
  ): Promise<unknown> {
    // version 仅用于乐观锁校验，ScanOrderStatusHistory 无该字段，写入前剥离
    const { version: _version, ...historyInput } = input;
    return tx.scanOrderStatusHistory.create({
      data: {
        ...historyInput,
        operatorType,
      },
    });
  }
}
