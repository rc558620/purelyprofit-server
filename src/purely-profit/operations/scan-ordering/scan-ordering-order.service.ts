import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { ListScanOrderingOrdersDto } from './dto/scan-ordering-order-query.dto';
import { ScanOrderingPricingService } from './scan-ordering-pricing.service';
import type { ScanOrderingOrderListItem } from './scan-ordering.types';
import { ScanOrderingOrderStateMachineService } from './scan-ordering-order-machine.service';

/**
 * 商家扫码点餐订单查询服务（轻量代理层）。
 *
 * 原订单服务已拆分为：
 * - ScanOrderingOrderStateMachineService：状态流转（接单、拒单、取消、完成）
 * - ScanOrderingOrderQueryService（当前文件）：查询与列表
 */
@Injectable()
export class ScanOrderingOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly pricingService: ScanOrderingPricingService,
    private readonly stateMachineService: ScanOrderingOrderStateMachineService,
  ) {}

  async acceptOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    return this.stateMachineService.acceptOrder(user, orderId, version);
  }

  async serveOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    return this.stateMachineService.serveOrder(user, orderId, version);
  }

  async rejectOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    return this.stateMachineService.rejectOrder(user, orderId, version, reason);
  }

  async cancelOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    return this.stateMachineService.cancelOrder(user, orderId, version, reason);
  }

  async completeOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    return this.stateMachineService.completeOrder(user, orderId, version);
  }

  async completeRefund(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    providerRefundNo?: string,
    providerRefundId?: string,
  ): Promise<void> {
    return this.stateMachineService.completeRefund(
      user,
      orderId,
      version,
      providerRefundNo,
      providerRefundId,
    );
  }

  async listOrders(
    user: AuthenticatedUser,
    query: ListScanOrderingOrdersDto,
  ): Promise<{
    items: ScanOrderingOrderListItem[];
    nextCursor: number | null;
  }> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看扫码点餐订单',
    );

    // 只查询当天的订单（本地时区 00:00:00 ~ 23:59:59）
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );

    const orders = await this.prisma.scanOrders.findMany({
      where: {
        storeId,
        createdAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.tableId !== undefined ? { tableId: query.tableId } : {}),
        ...(query.cursor !== undefined ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: (query.limit ?? 20) + 1,
      select: {
        id: true,
        orderNo: true,
        status: true,
        createdAt: true,
        version: true,
        table: { select: { name: true } },
        items: {
          select: { productNameSnapshot: true, quantity: true },
          orderBy: { id: 'asc' },
        },
        itemOriginalAmount: true,
        specificationExtraAmount: true,
        productDiscountAmount: true,
        orderDiscountAmount: true,
        taxAmount: true,
        serviceFeeAmount: true,
        paidAmount: true,
      },
    });

    const limit = query.limit ?? 20;
    const pageOrders = orders.slice(0, limit);

    return {
      items: pageOrders.map((order) => {
        const amountSummary = this.pricingService.calculateSummary({
          itemOriginalAmountCents: order.itemOriginalAmount,
          specificationExtraAmountCents: order.specificationExtraAmount,
          productDiscountAmountCents: order.productDiscountAmount,
          orderDiscountAmountCents: order.orderDiscountAmount,
          taxAmountCents: order.taxAmount,
          serviceFeeAmountCents: order.serviceFeeAmount,
          paidAmountCents: order.paidAmount,
        });

        return {
          id: order.id,
          orderNo: order.orderNo,
          version: order.version,
          itemSummary: order.items
            .map((item: any) => `${item.productNameSnapshot}×${item.quantity}`)
            .join('、'),
          tableName: order.table.name,
          status: order.status,
          createdAt: order.createdAt.toISOString(),
          amountSummary,
        };
      }),
      nextCursor:
        orders.length > limit ? (pageOrders.at(-1)?.id ?? null) : null,
    };
  }

  async getOrderDetail(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<unknown> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看扫码点餐订单',
    );
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, storeId },
      include: {
        table: { select: { name: true, tableCode: true } },
        items: { include: { specs: true }, orderBy: { id: 'asc' } },
        histories: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('扫码点餐订单不存在');
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      version: order.version,
      table: order.table,
      createdAt: order.createdAt.toISOString(),
      amountSummary: this.pricingService.calculateSummary({
        itemOriginalAmountCents: order.itemOriginalAmount,
        specificationExtraAmountCents: order.specificationExtraAmount,
        productDiscountAmountCents: order.productDiscountAmount,
        orderDiscountAmountCents: order.orderDiscountAmount,
        taxAmountCents: order.taxAmount,
        serviceFeeAmountCents: order.serviceFeeAmount,
        paidAmountCents: order.paidAmount,
      }),
      items: order.items.map((item: any) => ({
        name: item.productNameSnapshot,
        quantity: item.quantity,
        amount: this.pricingService.calculateSummary({
          itemOriginalAmountCents: item.lineTotalAmount,
          specificationExtraAmountCents: 0,
        }).payableAmount,
        specs: item.specs.map((spec: any) => ({
          name: spec.specOptionNameSnapshot,
          extraPrice: this.pricingService.calculateSummary({
            itemOriginalAmountCents: spec.extraPriceSnapshot,
            specificationExtraAmountCents: 0,
          }).payableAmount,
        })),
      })),
      histories: order.histories.map(
        (history: {
          fromStatus: string;
          toStatus: string;
          reason: string | null;
          createdAt: Date;
        }) => ({
          fromStatus: history.fromStatus,
          toStatus: history.toStatus,
          reason: history.reason ?? '',
          createdAt: history.createdAt.toISOString(),
        }),
      ),
    };
  }
}
