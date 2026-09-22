import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ScanOrderFulfillmentStatus,
  ScanOrderPickupNumberStatus,
  ScanOrderStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingPickupNumberService } from '../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
import { ScanOrderingSaleOrderBridgeService } from '../../../purely-club/scan-ordering/scan-ordering-sale-order-bridge.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingOrderStockService } from './scan-ordering-order-stock.service';
import { ORDER_TRANSITION_SELECT } from './scan-ordering.types';
import type { TransitionedOrderSnapshot } from './scan-ordering.types';

/** 一次订单状态流转的输入（乐观锁 + 目标状态 + 附加字段 + 事务内副作用）。 */
interface OrderTransitionInput {
  storeId: number;
  orderId: number;
  version: number;
  fromStatus: ScanOrderStatus;
  toStatus: ScanOrderStatus;
  fulfillmentStatus: ScanOrderFulfillmentStatus;
  /** 除状态/版本外的附加写入字段（如时间、取消原因、取餐号状态）。 */
  data?: Prisma.ScanOrdersUpdateManyMutationInput;
  /** 写入状态历史的原因（拒单/取消原因）。 */
  reason?: string;
  /** 事务内副作用：接单扣库存、出餐建销售记录等，仅在流转成功时执行。 */
  sideEffect?: (tx: Prisma.TransactionClient) => Promise<void>;
}

/**
 * 商家扫码点餐订单状态转换核心引擎。
 *
 * 职责：
 * - 提供统一的 transition 方法处理状态流转（乐观锁 + 历史 + 实时推送）
 * - 实现接单、出餐、取消、完成等基础状态变更
 * - 接单库存扣减委托 ScanOrderingOrderStockService
 */
@Injectable()
export class ScanOrderingOrderTransitionEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
    private readonly saleOrderBridgeService: ScanOrderingSaleOrderBridgeService,
    private readonly orderStockService: ScanOrderingOrderStockService,
  ) {}

  /**
   * 接单：pending_acceptance → preparing。
   *
   * 事务内完成状态流转并确认扣减预留库存：
   * 库存只在接单时扣减，退款/出餐不做库存操作，取消/拒单时释放预留。
   */
  async acceptOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    const { storeId, pickupVoiceEnabled } =
      await this.resolveMerchantStore(user);
    const updatedOrder = await this.transition({
      storeId,
      orderId,
      version,
      fromStatus: ScanOrderStatus.pending_acceptance,
      toStatus: ScanOrderStatus.preparing,
      fulfillmentStatus: ScanOrderFulfillmentStatus.preparing,
      data: { acceptedAt: new Date() },
      sideEffect: (tx) =>
        this.orderStockService.confirmDeductionInTransaction(
          tx,
          storeId,
          orderId,
        ),
    });
    this.publishStatusChanged(updatedOrder, pickupVoiceEnabled);
  }

  /**
   * 出餐：preparing → served。
   *
   * 事务内完成状态流转并创建销售记录（幂等）：
   * 交班页（handover-management）须在商家确认出餐后展示订单，
   * purelyClub 支付成功时不再立即生成销售记录。
   */
  async serveOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    const { storeId, pickupVoiceEnabled } =
      await this.resolveMerchantStore(user);

    // 读取订单取餐号与支付渠道：出餐时据此创建销售记录
    const pickupOrder = await this.prisma.scanOrders.findUnique({
      where: { id: orderId },
      select: {
        pickupNumber: true,
        paymentAttempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { paymentChannel: true },
        },
      },
    });
    if (!pickupOrder) throw new NotFoundException('扫码点餐订单不存在');

    const servedAt = new Date();
    // 微信渠道落库 wechat，其余（储值余额/开发态等）落库 other
    // 传入实际操作员：交班页操作员列展示主账号/店长/收银员
    const paymentMethod =
      pickupOrder.paymentAttempts[0]?.paymentChannel === 'wechat'
        ? 'wechat'
        : 'other';
    const updatedOrder = await this.transition({
      storeId,
      orderId,
      version,
      fromStatus: ScanOrderStatus.preparing,
      toStatus: ScanOrderStatus.served,
      fulfillmentStatus: ScanOrderFulfillmentStatus.served,
      data: {
        servedAt,
        // 仅当订单已分配取餐号时写入叫号时间与状态，避免对无取餐号订单播报 undefined
        ...(pickupOrder.pickupNumber != null
          ? {
              pickupCalledAt: servedAt,
              pickupNumberStatus: ScanOrderPickupNumberStatus.called,
            }
          : {}),
      },
      sideEffect: (tx) =>
        this.saleOrderBridgeService.createForPaidOrder(
          tx,
          orderId,
          paymentMethod,
          user,
        ),
    });
    this.publishStatusChanged(updatedOrder, pickupVoiceEnabled);
  }

  /** 取消：pending_payment → cancelled */
  async cancelOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    const { storeId, pickupVoiceEnabled } =
      await this.resolveMerchantStore(user);
    const updatedOrder = await this.transition({
      storeId,
      orderId,
      version,
      fromStatus: ScanOrderStatus.pending_payment,
      toStatus: ScanOrderStatus.cancelled,
      fulfillmentStatus: ScanOrderFulfillmentStatus.closed,
      data: { cancelReason: reason },
      reason,
    });
    this.publishStatusChanged(updatedOrder, pickupVoiceEnabled);
  }

  /** 完成：served → completed */
  async completeOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    const { storeId, pickupVoiceEnabled } =
      await this.resolveMerchantStore(user);
    const pickupOrder = await this.prisma.scanOrders.findUnique({
      where: { id: orderId },
      select: { pickupNumber: true, pickupCalledAt: true },
    });
    if (!pickupOrder) throw new NotFoundException('扫码点餐订单不存在');

    const completedAt = new Date();
    const updatedOrder = await this.transition({
      storeId,
      orderId,
      version,
      fromStatus: ScanOrderStatus.served,
      toStatus: ScanOrderStatus.completed,
      fulfillmentStatus: ScanOrderFulfillmentStatus.closed,
      data: {
        completedAt,
        // 已叫号订单才标记取餐完成，未叫号订单保持原取餐号状态
        ...(pickupOrder.pickupNumber != null &&
        pickupOrder.pickupCalledAt != null
          ? {
              pickupCompletedAt: completedAt,
              pickupNumberStatus: ScanOrderPickupNumberStatus.completed,
            }
          : {}),
      },
    });
    this.publishStatusChanged(updatedOrder, pickupVoiceEnabled);
  }

  /**
   * 统一状态流转：事务内乐观锁更新 → 执行副作用 → 写状态历史 → 返回推送快照。
   * 更新命中 0 行时区分「订单不存在」与「状态/版本已变化」并抛出对应异常。
   */
  private async transition(
    input: OrderTransitionInput,
  ): Promise<TransitionedOrderSnapshot> {
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const result = await tx.scanOrders.updateMany({
        where: {
          id: input.orderId,
          storeId: input.storeId,
          status: input.fromStatus,
          version: input.version,
        },
        data: {
          status: input.toStatus,
          fulfillmentStatus: input.fulfillmentStatus,
          version: { increment: 1 },
          ...input.data,
        },
      });
      if (result.count === 0) return null;

      if (input.sideEffect) await input.sideEffect(tx);

      await tx.scanOrderStatusHistory.create({
        data: {
          orderId: input.orderId,
          storeId: input.storeId,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          operatorType: 'merchant',
          reason: input.reason ?? '',
        },
      });

      return tx.scanOrders.findUnique({
        where: { id: input.orderId },
        select: ORDER_TRANSITION_SELECT,
      });
    });

    if (updatedOrder) return updatedOrder;
    await this.assertOrderExists(input.storeId, input.orderId);
    throw new ConflictException('订单状态已变化，请刷新后重试');
  }

  /** 解析商家可操作的门店，并读取语音播报开关（作为实时事件只读快照下发，
   * 避免 C 端额外请求或猜测商家开关状态）。 */
  private async resolveMerchantStore(user: AuthenticatedUser): Promise<{
    storeId: number;
    pickupVoiceEnabled: boolean;
  }> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权处理扫码点餐订单',
    );
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { pickupVoiceEnabled: true },
    });
    return { storeId, pickupVoiceEnabled: store?.pickupVoiceEnabled ?? false };
  }

  /** 订单不存在时抛 NotFoundException，供「更新未命中」场景区分原因。 */
  private async assertOrderExists(
    storeId: number,
    orderId: number,
  ): Promise<void> {
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, storeId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('扫码点餐订单不存在');
  }

  /** 推送订单状态变更事件（含取餐号与门店语音播报开关快照）。 */
  private publishStatusChanged(
    order: TransitionedOrderSnapshot,
    pickupVoiceEnabled: boolean,
  ): void {
    this.realtimeService.publishOrderStatusChanged({
      orderId: order.id,
      storeId: order.storeId,
      sessionId: order.sessionId,
      version: order.version,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      pickupNumber: order.pickupNumber,
      pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
        order.pickupNumber,
      ),
      pickupNumberStatus: order.pickupNumberStatus,
      pickupCalledAt: order.pickupCalledAt?.toISOString() ?? null,
      pickupCompletedAt: order.pickupCompletedAt?.toISOString() ?? null,
      pickupVoiceEnabled,
    });
  }
}
