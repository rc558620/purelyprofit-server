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
  ScanOrderingOrderDetailPayload,
  ScanOrderingOrderListItem,
} from './scan-ordering.types';
import { ScanOrderingOrderStateMachineService } from './scan-ordering-order-machine.service';
import { ScanOrderingPickupNumberService } from '../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
import {
  toOrderDetailPayload,
  toOrderListItem,
  type ScanOrderListItemSource,
} from './scan-ordering-order.mapper';

/**
 * 商家扫码点餐订单服务（查询编排 + 状态流转代理）。
 *
 * - 状态流转：代理到 ScanOrderingOrderStateMachineService
 * - 查询编排：负责门店校验、时间范围、筛选条件、昵称/加餐序号查询
 * - 响应组装：下沉到 scan-ordering-order.mapper（纯函数，金额统一后端计算）
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

  // ── 状态流转代理 ─────────────────────────────────────────

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
    provider?: { refundNo?: string; refundId?: string },
  ): Promise<void> {
    return this.stateMachineService.completeRefund(
      user,
      orderId,
      version,
      provider,
    );
  }

  // ── 订单查询 ─────────────────────────────────────────────

  async listOrders(
    user: AuthenticatedUser,
    query: ListScanOrderingOrdersDto,
  ): Promise<{
    items: ScanOrderingOrderListItem[];
    nextCursor: number | null;
  }> {
    const storeId = await this.resolveOrderStoreId(user);
    const { startOfDay, endOfDay } = this.resolveListTimeRange(query);
    const where = this.buildListWhere(storeId, query, startOfDay, endOfDay);
    const limit = query.limit ?? 100;
    const orders = await this.fetchOrderPage(where, limit);
    const guestNameMap = await this.fetchGuestNameMap(orders);
    const pageOrders = orders.slice(0, limit);
    // “首单/加餐”判定以 diningRoundId 维度计算：同一用餐轮次（diningRoundId 相同）
    // 内的累计下单序号，跨桌或清桌（diningRoundId 重新生成）会重新从 1 开始
    const sequences = await this.fetchDiningRoundSequences(pageOrders);
    return {
      items: pageOrders.map((order) =>
        toOrderListItem({
          order,
          guestName: this.resolveGuestName(order, guestNameMap),
          sessionOrderSequence: sequences.get(order.id) ?? 1,
          calculateSummary: this.pricingService.calculateSummary,
          formatPickupNumber: this.pickupNumberService.formatPickupNumber,
        }),
      ),
      nextCursor:
        orders.length > limit ? (pageOrders.at(-1)?.id ?? null) : null,
    };
  }

  async getOrderDetail(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<ScanOrderingOrderDetailPayload> {
    const storeId = await this.resolveOrderStoreId(user);
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, storeId },
      include: {
        table: { select: { name: true, tableCode: true } },
        items: { include: { specs: true }, orderBy: { id: 'asc' } },
        histories: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('扫码点餐订单不存在');
    return toOrderDetailPayload({
      order,
      calculateSummary: this.pricingService.calculateSummary,
      formatPickupNumber: this.pickupNumberService.formatPickupNumber,
    });
  }

  // ── 查询私有方法 ─────────────────────────────────────────

  /** 统一解析当前商家门店并校验查看权限。 */
  private resolveOrderStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看扫码点餐订单',
    );
  }

  /**
   * 解析列表时间范围：优先使用自定义时间范围；
   * 否则默认当天 00:00:00 ~ 23:59:59（上海时区）。
   */
  private resolveListTimeRange(query: ListScanOrderingOrdersDto): {
    startOfDay: Date;
    endOfDay: Date;
  } {
    if (query.startTime && query.endTime) {
      return {
        startOfDay: new Date(query.startTime),
        endOfDay: new Date(query.endTime),
      };
    }
    const now = new Date();
    const dayStartMs = getShanghaiDayStartMs(now.getTime());
    return {
      startOfDay: new Date(dayStartMs),
      endOfDay: new Date(addShanghaiDays(dayStartMs, 1)),
    };
  }

  /** 构建订单列表查询条件（门店、时间、状态、桌台、游标）。 */
  private buildListWhere(
    storeId: number,
    query: ListScanOrderingOrdersDto,
    startOfDay: Date,
    endOfDay: Date,
  ): Record<string, unknown> {
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
      where.table = {
        name: {
          contains: query.tableKeyword,
          mode: 'insensitive',
        },
      };
    }
    return where;
  }

  /** 查询一页订单（多取一条用于判断是否有下一页）。 */
  private fetchOrderPage(
    where: Record<string, unknown>,
    limit: number,
  ): Promise<ScanOrderListItemSource[]> {
    return this.prisma.scanOrders.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
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
        manualEntry: true,
        manualEntryMetadata: true,
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
        payableAmount: true,
        marketingSnapshot: true,
        pickupNumber: true,
        pickupNumberStatus: true,
        pickupCalledAt: true,
      },
    });
  }

  /** 批量查询顾客昵称；缺失或查询失败时回退为“顾客”。 */
  private async fetchGuestNameMap(
    orders: ScanOrderListItemSource[],
  ): Promise<Map<number, string>> {
    const userMap = new Map<number, string>();
    const uniqueIds = Array.from(
      new Set(
        orders
          .map((order) => order.clubUserId)
          .filter((id): id is number => !!id),
      ),
    );
    if (uniqueIds.length === 0) return userMap;
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true, name: true },
      });
      users.forEach((user) => {
        userMap.set(user.id, user.name || '顾客');
      });
    } catch (error) {
      console.error('Failed to fetch user nicknames:', error);
    }
    return userMap;
  }

  /**
   * 计算“首单/加餐”序号：同一门店同一桌同一用户在同一 diningRound 内
   * 的累计下单序号（含当前页之前的订单），>1 即视为加餐。
   */
  private async fetchDiningRoundSequences(
    orders: ScanOrderListItemSource[],
  ): Promise<Map<number, number>> {
    const diningRoundUserKeys = orders
      .filter((order) => order.diningRoundId && order.clubUserId)
      .map((order) => ({
        diningRoundId: order.diningRoundId,
        clubUserId: order.clubUserId!,
      }));
    const sequences = new Map<number, number>();
    if (diningRoundUserKeys.length === 0) return sequences;
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
      sequences.set(order.id, sequence);
    });
    return sequences;
  }

  /** 解析顾客昵称展示值。 */
  private resolveGuestName(
    order: { clubUserId: number | null; manualEntry: boolean; manualEntryMetadata: unknown },
    guestNameMap: Map<number, string>,
  ): string {
    if (order.manualEntry) {
      const meta = order.manualEntryMetadata as Record<string, unknown> | null;
      const sourceChannel = meta?.sourceChannel as string | undefined;
      const channelLabels: Record<string, string> = {
        meituan: '美团外卖',
        eleme: '饿了么',
        meituanVoucher: '美团团购',
        douyin: '抖音团购',
        dianping: '大众点评',
        other: '其他平台',
      };
      return sourceChannel ? channelLabels[sourceChannel] ?? sourceChannel : '手工录入';
    }
    if (order.clubUserId && guestNameMap.has(order.clubUserId)) {
      return guestNameMap.get(order.clubUserId)!;
    }
    return '顾客';
  }
}
