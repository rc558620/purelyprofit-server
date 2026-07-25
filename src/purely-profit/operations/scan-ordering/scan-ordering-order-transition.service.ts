import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ScanOrderFulfillmentStatus, ScanOrderStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
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
    await this.transitionOrder(
      user,
      orderId,
      version,
      ScanOrderStatus.preparing,
      ScanOrderStatus.served,
      ScanOrderFulfillmentStatus.served,
      { servedAt: new Date() },
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
    await this.transitionOrder(
      user,
      orderId,
      version,
      ScanOrderStatus.served,
      ScanOrderStatus.completed,
      ScanOrderFulfillmentStatus.closed,
      { completedAt: new Date() },
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
  ): Promise<void> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权处理扫码点餐订单',
    );

    const result = await this.prisma.scanOrders.updateMany({
      where: { id: orderId, storeId, status: expectedStatus, version },
      data: {
        status: nextStatus,
        fulfillmentStatus,
        version: { increment: 1 },
        ...extraData,
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
          storeId: true,
          sessionId: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
        },
      });

      if (updatedOrder) {
        this.realtimeService.publishOrderStatusChanged({
          orderId: updatedOrder.id,
          storeId: updatedOrder.storeId,
          sessionId: updatedOrder.sessionId,
          status: updatedOrder.status,
          paymentStatus: updatedOrder.paymentStatus,
          fulfillmentStatus: updatedOrder.fulfillmentStatus,
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
