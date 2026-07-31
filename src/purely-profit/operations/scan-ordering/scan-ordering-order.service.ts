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

    // 默认时间范围：当天 00:00:00 ~ 23:59:59
    let startOfDay!: Date;
    let endOfDay!: Date;

    // 如果提供了自定义时间范围，则使用提供的值
    if (query.startTime && query.endTime) {
      startOfDay = new Date(query.startTime);
      endOfDay = new Date(query.endTime);
    } else {
      // 否则使用当天范围
      const now = new Date();
      startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }

    // 构建动态查询条件
    const where: Record<string, unknown> = {
      storeId,
      createdAt: {
        gte: startOfDay,
        lt: endOfDay,
      },
      ...(query.status ? { status: query.status as unknown } : {}),
      ...(query.tableId ? { tableId: query.tableId } : {}),
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };

    // 添加桌号模糊匹配
    if (query.tableKeyword) {
      (where as Record<string, unknown>).table = {
        name: {
          contains: query.tableKeyword,
          mode: 'insensitive',
        },
      };
    }

    // 客人姓名将从前端根据 clubUserId 动态查询

    const orders = await this.prisma.scanOrders.findMany({
      where,
      orderBy: { id: 'desc' },
      take: (query.limit ?? 20) + 1,
      select: {
        id: true,
        orderNo: true,
        status: true,
        createdAt: true,
        version: true,
        clubUserId: true,
        sessionId: true,
        remark: true,
        table: { select: { name: true } },
        items: {
          select: {
            productNameSnapshot: true,
            productImageUrlSnapshot: true,
            quantity: true,
          },
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

    // 🔥 批量查询用户昵称
    const userMap: Map<number, string> = new Map();
    const userIds = orders
      .map((order: (typeof orders)[number]) => order.clubUserId)
      .filter((id): id is number => !!id);
    if (userIds.length > 0 && Array.from(new Set(userIds)).length > 0) {
      try {
        const uniqueIds = Array.from(new Set(userIds));
        const users = await this.prisma.user.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, name: true },
        });
        users.forEach((u) => {
          userMap.set(u.id, u.name || '顾客');
        });
      } catch (error) {
        console.error('Failed to fetch user nicknames:', error);
      }
    }

    const limit = query.limit ?? 20;
    const pageOrders = orders.slice(0, limit);
    const sessionUserKeys = pageOrders
      .filter((order) => order.sessionId && order.clubUserId)
      .map((order) => ({
        sessionId: order.sessionId,
        clubUserId: order.clubUserId!,
      }));
    const sessionOrderSequences = new Map<number, number>();
    if (sessionUserKeys.length > 0) {
      const priorOrders = await this.prisma.scanOrders.findMany({
        where: {
          OR: sessionUserKeys.map(({ sessionId, clubUserId }) => ({
            sessionId,
            clubUserId,
          })),
          deletedAt: null,
        },
        select: {
          sessionId: true,
          clubUserId: true,
          id: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const counters = new Map<string, number>();
      priorOrders.forEach((order) => {
        const key = `${order.sessionId}:${order.clubUserId}`;
        const sequence = (counters.get(key) ?? 0) + 1;
        counters.set(key, sequence);
        sessionOrderSequences.set(order.id, sequence);
      });
    }

    return {
      items: pageOrders.map((order: (typeof pageOrders)[number]) => {
        const amountSummary = this.pricingService.calculateSummary({
          itemOriginalAmountCents: order.itemOriginalAmount,
          specificationExtraAmountCents: order.specificationExtraAmount,
          productDiscountAmountCents: order.productDiscountAmount,
          orderDiscountAmountCents: order.orderDiscountAmount,
          taxAmountCents: order.taxAmount,
          serviceFeeAmountCents: order.serviceFeeAmount,
          paidAmountCents: order.paidAmount,
        });

        // 🔥 使用真实的用户昵称
        let guestName = '顾客'; // 默认值
        if (order.clubUserId && userMap.has(order.clubUserId)) {
          guestName = userMap.get(order.clubUserId)!; // 从 Map 中获取昵称
        }

        return {
          id: order.id,
          orderNo: order.orderNo,
          version: order.version,
          itemSummary: order.items
            .map(
              (item: (typeof order.items)[number]) =>
                `${item.productNameSnapshot}×${item.quantity}`,
            )
            .join('、'),
          remark: order.remark,
          tableName: order.table.name,
          status: order.status,
          createdAt: order.createdAt.toISOString(),
          amountSummary,
          guestName, // 🔥 返回客户昵称
          sessionOrderSequence: sessionOrderSequences.get(order.id) ?? 1,
          imageUrl:
            order.items.find(
              (item: (typeof order.items)[number]) =>
                item.productImageUrlSnapshot,
            )?.productImageUrlSnapshot ?? null,
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
    const prismaOrder = order; // 明确类型注解
    return {
      id: prismaOrder.id,
      orderNo: prismaOrder.orderNo,
      status: prismaOrder.status,
      version: prismaOrder.version,
      table: prismaOrder.table,
      createdAt: prismaOrder.createdAt.toISOString(),
      amountSummary: this.pricingService.calculateSummary({
        itemOriginalAmountCents: prismaOrder.itemOriginalAmount,
        specificationExtraAmountCents: prismaOrder.specificationExtraAmount,
        productDiscountAmountCents: prismaOrder.productDiscountAmount,
        orderDiscountAmountCents: prismaOrder.orderDiscountAmount,
        taxAmountCents: prismaOrder.taxAmount,
        serviceFeeAmountCents: prismaOrder.serviceFeeAmount,
        paidAmountCents: prismaOrder.paidAmount,
      }),
      items: prismaOrder.items.map(
        (item: (typeof prismaOrder.items)[number]) => ({
          name: item.productNameSnapshot,
          quantity: item.quantity,
          amount: this.pricingService.calculateSummary({
            itemOriginalAmountCents: item.lineTotalAmount,
            specificationExtraAmountCents: 0,
          }).payableAmount,
          specs: item.specs.map((spec: (typeof item.specs)[number]) => ({
            name: spec.specOptionNameSnapshot,
            extraPrice: this.pricingService.calculateSummary({
              itemOriginalAmountCents: spec.extraPriceSnapshot,
              specificationExtraAmountCents: 0,
            }).payableAmount,
          })),
        }),
      ),
      histories: prismaOrder.histories.map(
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
