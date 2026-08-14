import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
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

/**
 * 商家扫码点餐订单状态转换核心引擎。
 *
 * 职责：
 * - 提供统一的 transitionOrder 方法处理状态流转
 * - 实现接单、出餐、取消、完成等基础状态变更
 * - 维护状态历史、实时更新、版本控制
 */
@Injectable()
export class ScanOrderingOrderTransitionEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
    private readonly saleOrderBridgeService: ScanOrderingSaleOrderBridgeService,
  ) {}

  /**
   * 接单：pending_acceptance → preparing。
   *
   * 事务内完成状态流转并确认扣减预留库存：
   * - 菜单商品：reservedQuantity 转扣减，salesCount 累计；
   * - 关联共用商品（productId 非空）：此时才扣减 product.stock；
   * - 规格选项：reservedQuantity 转扣减。
   * 退款/出餐不做任何库存操作，取消/拒单时释放预留。
   */
  async acceptOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权处理扫码点餐订单',
    );

    // 读取门店语音播报开关，作为实时事件只读快照下发，避免 C 端额外请求或猜测商家开关状态
    const pickupStore = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { pickupVoiceEnabled: true },
    });
    const pickupVoiceEnabled = pickupStore?.pickupVoiceEnabled ?? false;

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const result = await tx.scanOrders.updateMany({
        where: {
          id: orderId,
          storeId,
          status: ScanOrderStatus.pending_acceptance,
          version,
        },
        data: {
          status: ScanOrderStatus.preparing,
          fulfillmentStatus: ScanOrderFulfillmentStatus.preparing,
          version: { increment: 1 },
          acceptedAt: new Date(),
        },
      });
      if (result.count === 0) {
        return null;
      }

      // 接单确认：将预留库存转为实际扣减（库存只在接单时扣减）
      await this.confirmStockDeductionInTransaction(tx, storeId, orderId);

      await tx.scanOrderStatusHistory.create({
        data: {
          orderId,
          storeId,
          fromStatus: ScanOrderStatus.pending_acceptance,
          toStatus: ScanOrderStatus.preparing,
          operatorType: 'merchant',
          reason: '',
        },
      });

      return tx.scanOrders.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          version: true,
          storeId: true,
          sessionId: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          pickupNumber: true,
          pickupBusinessDate: true,
          pickupNumberStatus: true,
          pickupCalledAt: true,
          pickupCompletedAt: true,
        },
      });
    });

    if (!updatedOrder) {
      const order = await this.prisma.scanOrders.findFirst({
        where: { id: orderId, storeId },
        select: { id: true },
      });
      if (!order) {
        throw new NotFoundException('扫码点餐订单不存在');
      }
      throw new ConflictException('订单状态已变化，请刷新后重试');
    }

    this.realtimeService.publishOrderStatusChanged({
      orderId: updatedOrder.id,
      storeId: updatedOrder.storeId,
      sessionId: updatedOrder.sessionId,
      version: updatedOrder.version,
      status: updatedOrder.status,
      paymentStatus: updatedOrder.paymentStatus,
      fulfillmentStatus: updatedOrder.fulfillmentStatus,
      pickupNumber: updatedOrder.pickupNumber,
      pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
        updatedOrder.pickupNumber,
      ),
      pickupNumberStatus: updatedOrder.pickupNumberStatus,
      pickupCalledAt: updatedOrder.pickupCalledAt?.toISOString() ?? null,
      pickupCompletedAt: updatedOrder.pickupCompletedAt?.toISOString() ?? null,
      pickupVoiceEnabled,
    });
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
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权处理扫码点餐订单',
    );

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

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const result = await tx.scanOrders.updateMany({
        where: {
          id: orderId,
          storeId,
          status: ScanOrderStatus.preparing,
          version,
        },
        data: {
          status: ScanOrderStatus.served,
          fulfillmentStatus: ScanOrderFulfillmentStatus.served,
          version: { increment: 1 },
          servedAt,
          // 仅当订单已分配取餐号时写入叫号时间与状态，避免对无取餐号订单播报 undefined
          ...(pickupOrder.pickupNumber != null
            ? {
                pickupCalledAt: servedAt,
                pickupNumberStatus: ScanOrderPickupNumberStatus.called,
              }
            : undefined),
        },
      });
      if (result.count === 0) {
        return null;
      }

      await tx.scanOrderStatusHistory.create({
        data: {
          orderId,
          storeId,
          fromStatus: ScanOrderStatus.preparing,
          toStatus: ScanOrderStatus.served,
          operatorType: 'merchant',
          reason: '',
        },
      });

      // 出餐确认后创建销售记录（幂等）：交班页在出餐后展示订单
      // 微信渠道落库 wechat，其余（储值余额/开发态等）落库 other
      // 传入实际操作员：交班页操作员列展示主账号/店长/收银员
      const paymentMethod =
        pickupOrder.paymentAttempts[0]?.paymentChannel === 'wechat'
          ? 'wechat'
          : 'other';
      await this.saleOrderBridgeService.createForPaidOrder(
        tx,
        orderId,
        paymentMethod,
        user,
      );

      return tx.scanOrders.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          version: true,
          storeId: true,
          sessionId: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          pickupNumber: true,
          pickupBusinessDate: true,
          pickupNumberStatus: true,
          pickupCalledAt: true,
          pickupCompletedAt: true,
        },
      });
    });

    if (!updatedOrder) {
      const order = await this.prisma.scanOrders.findFirst({
        where: { id: orderId, storeId },
        select: { id: true },
      });
      if (!order) {
        throw new NotFoundException('扫码点餐订单不存在');
      }
      throw new ConflictException('订单状态已变化，请刷新后重试');
    }

    // 读取门店语音播报开关，作为实时事件只读快照下发，避免 C 端额外请求或猜测商家开关状态
    const pickupStore = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { pickupVoiceEnabled: true },
    });
    const pickupVoiceEnabled = pickupStore?.pickupVoiceEnabled ?? false;

    this.realtimeService.publishOrderStatusChanged({
      orderId: updatedOrder.id,
      storeId: updatedOrder.storeId,
      sessionId: updatedOrder.sessionId,
      version: updatedOrder.version,
      status: updatedOrder.status,
      paymentStatus: updatedOrder.paymentStatus,
      fulfillmentStatus: updatedOrder.fulfillmentStatus,
      pickupNumber: updatedOrder.pickupNumber,
      pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
        updatedOrder.pickupNumber,
      ),
      pickupNumberStatus: updatedOrder.pickupNumberStatus,
      pickupCalledAt: updatedOrder.pickupCalledAt?.toISOString() ?? null,
      pickupCompletedAt: updatedOrder.pickupCompletedAt?.toISOString() ?? null,
      pickupVoiceEnabled,
    });
  }

  /** 取消：pending_payment → cancelled */
  async cancelOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    await this.transitionOrder(
      user,
      orderId,
      version,
      ScanOrderStatus.pending_payment,
      ScanOrderStatus.cancelled,
      ScanOrderFulfillmentStatus.closed,
      { cancelReason: reason },
    );
  }

  /** 完成：served → completed */
  async completeOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    const pickupOrder = await this.prisma.scanOrders.findUnique({
      where: { id: orderId },
      select: { pickupNumber: true, pickupCalledAt: true },
    });
    if (!pickupOrder) throw new NotFoundException('扫码点餐订单不存在');
    const completedAt = new Date();
    await this.transitionOrder(
      user,
      orderId,
      version,
      ScanOrderStatus.served,
      ScanOrderStatus.completed,
      ScanOrderFulfillmentStatus.closed,
      { completedAt },
      pickupOrder.pickupNumber != null && pickupOrder.pickupCalledAt != null
        ? {
            pickupCompletedAt: completedAt,
            pickupNumberStatus: ScanOrderPickupNumberStatus.completed,
          }
        : undefined,
    );
  }

  /**
   * 事务内确认扣减预留库存（接单专用）：
   * - 菜单商品：reservedQuantity 扣减、stockQuantity 扣减、salesCount 累计；
   * - 关联共用商品（productId 非空）：此时才扣减 product.stock；
   * - 规格选项：reservedQuantity 转扣减、stockQuantity 扣减。
   * 历史订单（无预留记录）跳过扣减，避免重复扣库存。
   */
  private async confirmStockDeductionInTransaction(
    tx: Prisma.TransactionClient,
    storeId: number,
    orderId: number,
  ): Promise<void> {
    const items = await tx.scanOrderItem.findMany({
      where: { orderId },
      select: {
        menuProductId: true,
        quantity: true,
        menuProduct: {
          select: { productId: true, stockMode: true },
        },
        specs: { select: { specOptionId: true } },
      },
    });

    await Promise.all(
      items.map(async (item) => {
        // 菜单商品：仅当存在预留时才扣减（新订单），历史订单（reserved=0）跳过
        const menuUpdated = await tx.scanOrderingMenuProduct.updateMany({
          where: {
            id: item.menuProductId,
            storeId,
            reservedQuantity: { gte: item.quantity },
          },
          data: {
            reservedQuantity: { decrement: item.quantity },
            ...(item.menuProduct.stockMode === 'finite'
              ? { stockQuantity: { decrement: item.quantity } }
              : {}),
            salesCount: { increment: item.quantity },
            version: { increment: 1 },
          },
        });
        if (menuUpdated.count === 0) return;

        // 共用商品库存：仅在接单时扣减（Q1 决策），不足时阻止接单
        if (item.menuProduct.productId !== null) {
          const productUpdated = await tx.product.updateMany({
            where: {
              id: item.menuProduct.productId,
              storeId,
              deletedAt: null,
              stock: { gte: item.quantity },
            },
            data: { stock: { decrement: item.quantity } },
          });
          if (productUpdated.count === 0) {
            throw new ConflictException('商品库存不足，无法接单');
          }
        }
      }),
    );

    // 规格预留转扣减（仅当存在预留时）
    const specQuantities = new Map<number, number>();
    for (const item of items) {
      for (const spec of item.specs) {
        specQuantities.set(
          spec.specOptionId,
          (specQuantities.get(spec.specOptionId) ?? 0) + item.quantity,
        );
      }
    }
    await Promise.all(
      Array.from(specQuantities.entries()).map(
        async ([specOptionId, quantity]) => {
          await tx.scanOrderingSpecOption.updateMany({
            where: {
              id: specOptionId,
              reservedQuantity: { gte: quantity },
            },
            data: {
              reservedQuantity: { decrement: quantity },
              stockQuantity: { decrement: quantity },
              version: { increment: 1 },
            },
          });
        },
      ),
    );
  }

  private async transitionOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    expectedStatus: ScanOrderStatus,
    nextStatus: ScanOrderStatus,
    fulfillmentStatus: ScanOrderFulfillmentStatus,
    extraData: {
      rejectReason?: string;
      cancelReason?: string;
      acceptedAt?: Date;
      servedAt?: Date;
      completedAt?: Date;
    } = {},
    pickupData?: {
      pickupCalledAt?: Date;
      pickupCompletedAt?: Date;
      pickupNumberStatus?: ScanOrderPickupNumberStatus;
    },
  ): Promise<void> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权处理扫码点餐订单',
    );

    // 读取门店语音播报开关，作为实时事件只读快照下发，避免 C 端额外请求或猜测商家开关状态
    const pickupStore = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { pickupVoiceEnabled: true },
    });
    const pickupVoiceEnabled = pickupStore?.pickupVoiceEnabled ?? false;

    const result = await this.prisma.scanOrders.updateMany({
      where: { id: orderId, storeId, status: expectedStatus, version },
      data: {
        status: nextStatus,
        fulfillmentStatus,
        version: { increment: 1 },
        ...extraData,
        ...pickupData,
      },
    });

    if (result.count > 0) {
      await this.prisma.scanOrderStatusHistory.create({
        data: {
          orderId,
          storeId,
          fromStatus: expectedStatus,
          toStatus: nextStatus,
          operatorType: 'merchant',
          reason: extraData.rejectReason ?? extraData.cancelReason ?? '',
        },
      });

      const updatedOrder = await this.prisma.scanOrders.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          version: true,
          storeId: true,
          sessionId: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          pickupNumber: true,
          pickupBusinessDate: true,
          pickupNumberStatus: true,
          pickupCalledAt: true,
          pickupCompletedAt: true,
        },
      });

      if (updatedOrder) {
        this.realtimeService.publishOrderStatusChanged({
          orderId: updatedOrder.id,
          storeId: updatedOrder.storeId,
          sessionId: updatedOrder.sessionId,
          version: updatedOrder.version,
          status: updatedOrder.status,
          paymentStatus: updatedOrder.paymentStatus,
          fulfillmentStatus: updatedOrder.fulfillmentStatus,
          pickupNumber: updatedOrder.pickupNumber,
          pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
            updatedOrder.pickupNumber,
          ),
          pickupNumberStatus: updatedOrder.pickupNumberStatus,
          pickupCalledAt: updatedOrder.pickupCalledAt?.toISOString() ?? null,
          pickupCompletedAt:
            updatedOrder.pickupCompletedAt?.toISOString() ?? null,
          pickupVoiceEnabled,
        });
      }
      return;
    }

    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, storeId },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException('扫码点餐订单不存在');
    }

    throw new ConflictException('订单状态已变化，请刷新后重试');
  }
}
