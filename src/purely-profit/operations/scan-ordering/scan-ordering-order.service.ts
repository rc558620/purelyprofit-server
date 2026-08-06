import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  addShanghaiDays,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { ListScanOrderingOrdersDto } from './dto/scan-ordering-order-query.dto';
import { ScanOrderingPricingService } from './scan-ordering-pricing.service';
import type {
  ScanOrderingOrderItemSummary,
  ScanOrderingOrderListItem,
} from './scan-ordering.types';
import { ScanOrderingOrderStateMachineService } from './scan-ordering-order-machine.service';
import { ScanOrderingPickupNumberService } from '../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
import { fenToYuan } from '../../../purely-club/scan-ordering/club-scan-ordering-order.mapper';

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
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
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
      const dayStartMs = getShanghaiDayStartMs(now.getTime());
      startOfDay = new Date(dayStartMs);
      endOfDay = new Date(addShanghaiDays(dayStartMs, 1));
    }

    // 构建动态查询条件
    const where: Record<string, unknown> = {
      storeId,
      createdAt: {
        gte: startOfDay,
        lt: endOfDay,
      },
      ...(query.status
        ? { status: query.status as unknown }
        : {
            status: {
              in: [
                'pending_payment',
                'pending_acceptance',
                'preparing',
                'served',
                'refunding',
              ],
            },
          }),
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
      take: (query.limit ?? 100) + 1,
      select: {
        id: true,
        orderNo: true,
        status: true,
        createdAt: true,
        version: true,
        clubUserId: true,
        sessionId: true,
        diningRoundId: true,
        remark: true,
        table: { select: { name: true } },
        items: {
          select: {
            productNameSnapshot: true,
            productImageUrlSnapshot: true,
            quantity: true,
            unitPriceAmount: true,
            lineTotalAmount: true,
            payableLineAmount: true,
            specs: {
              select: { specOptionNameSnapshot: true },
              orderBy: { id: 'asc' },
            },
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
        pickupNumber: true,
        pickupNumberStatus: true,
        pickupCalledAt: true,
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

    const limit = query.limit ?? 100;
    const pageOrders = orders.slice(0, limit);
    // "首单/加餐"判定以 diningRoundId 维度计算：同一个人在同一家门店的同一张桌
    // 台、本轮用餐轮次（diningRoundId 相同）内的累计下单序号，跨桌或清桌
    // (session 状态被清成 checked_out 后 diningRoundId 会重新生成) 会重新从 1 开始。
    // 字段名沿用 sessionOrderSequence 以兼容 purelyprofit 前端消费。
    const diningRoundUserKeys = pageOrders
      .filter((order) => order.diningRoundId && order.clubUserId)
      .map((order) => ({
        diningRoundId: order.diningRoundId,
        clubUserId: order.clubUserId!,
      }));
    const diningRoundOrderSequences = new Map<number, number>();
    if (diningRoundUserKeys.length > 0) {
      const priorOrders = await this.prisma.scanOrders.findMany({
        where: {
          OR: diningRoundUserKeys.map(({ diningRoundId, clubUserId }) => ({
            diningRoundId,
            clubUserId,
          })),
          deletedAt: null,
        },
        select: {
          diningRoundId: true,
          clubUserId: true,
          id: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const counters = new Map<string, number>();
      priorOrders.forEach((order) => {
        const key = `${order.diningRoundId}:${order.clubUserId}`;
        const sequence = (counters.get(key) ?? 0) + 1;
        counters.set(key, sequence);
        diningRoundOrderSequences.set(order.id, sequence);
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

        // 构建多规格场景下的商品明细：每条 ScanOrderItem 已带有完整的
        // (商品+规格)快照,直接以 1:1 方式输出;前端可在卡片里独立渲染图片、
        // 规格、数量、金额,避免用户阅读括号嵌套导致的认知负担。
        const itemSummaries = order.items.map(
          (item: (typeof order.items)[number]): ScanOrderingOrderItemSummary => ({
            productName: item.productNameSnapshot,
            productImageUrl: item.productImageUrlSnapshot ?? null,
            quantity: item.quantity,
            specs: (item.specs ?? []).map(
              (spec) => spec.specOptionNameSnapshot,
            ),
            unitPrice: fenToYuan(item.unitPriceAmount ?? 0),
            lineTotalAmount: fenToYuan(item.lineTotalAmount ?? 0),
            payableLineAmount: fenToYuan(item.payableLineAmount ?? 0),
          }),
        );
        // 兼容旧前端消费的简洁文本摘要: 仅展示 「商品名×数量」,不再嵌入
        // 括号规格列表,完整规格清单统一通过 items 数组下发。
        const itemSummary = itemSummaries
          .map((item) => `${item.productName}×${item.quantity}`)
          .join('、');

        return {
          id: order.id,
          orderNo: order.orderNo,
          version: order.version,
          itemSummary,
          items: itemSummaries,
          remark: order.remark,
          tableName: order.table.name,
          status: order.status,
          createdAt: order.createdAt.toISOString(),
          amountSummary,
          guestName, // 🔥 返回客户昵称
          // 字段名沿用 sessionOrderSequence 以兼容前端；语义上为同一 diningRound
          // 内的累计序号，>1 即视为加餐。
          sessionOrderSequence: diningRoundOrderSequences.get(order.id) ?? 1,
          pickupNumber: order.pickupNumber,
          pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
            order.pickupNumber,
          ),
          pickupNumberStatus: order.pickupNumberStatus,
          pickupCalledAt: order.pickupCalledAt?.toISOString() ?? null,
          // 兼容旧前端: 仍以首个有图片的商品作为卡片缩略图;卡片层应改用 items
          // 数组渲染多张缩略图,本字段保留作为回退。
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
      pickupNumber: prismaOrder.pickupNumber,
      pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
        prismaOrder.pickupNumber,
      ),
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
