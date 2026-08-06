import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ScanOrderFulfillmentStatus,
  ScanOrderPickupNumberStatus,
  ScanOrderStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingPickupNumberService } from '../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
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
  ) {}

  /** 接单：pending_acceptance → preparing */
  async acceptOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    await this.transitionOrder(
      user,
      orderId,
      version,
      ScanOrderStatus.pending_acceptance,
      ScanOrderStatus.preparing,
      ScanOrderFulfillmentStatus.preparing,
      { acceptedAt: new Date() },
    );
  }

  /** 出餐：preparing → served */
  async serveOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    // 仅当订单已分配取餐号时写入叫号时间与状态，避免对无取餐号订单播报 undefined
    const pickupOrder = await this.prisma.scanOrders.findUnique({
      where: { id: orderId },
      select: { pickupNumber: true },
    });
    if (!pickupOrder) throw new NotFoundException('扫码点餐订单不存在');
    const servedAt = new Date();
    await this.transitionOrder(
      user,
      orderId,
      version,
      ScanOrderStatus.preparing,
      ScanOrderStatus.served,
      ScanOrderFulfillmentStatus.served,
      { servedAt },
      pickupOrder.pickupNumber != null
        ? {
            pickupCalledAt: servedAt,
            pickupNumberStatus: ScanOrderPickupNumberStatus.called,
          }
        : undefined,
    );
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
