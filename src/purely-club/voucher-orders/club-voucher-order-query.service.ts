// 团购券订单查询服务：列表/详情 + 惰性过期
import { BadRequestException, Injectable } from '@nestjs/common';
import type { ClubVoucherOrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE } from './club-voucher-orders.constants';
import {
  toDetailDto,
  toListItem,
  VOUCHER_ORDER_SORT_MAP,
} from './club-voucher-order-query.helper';
import type {
  ClubVoucherOrderDetailDto,
  ClubVoucherOrderListResponseDto,
} from './dto/club-voucher-order.dto';

@Injectable()
export class ClubVoucherOrderQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** 我的团购券订单列表（状态筛选 + offset 分页） */
  async listVoucherOrders(
    currentContext: ClubCurrentContext,
    query: { status?: string; limit?: number; offset?: number },
  ): Promise<ClubVoucherOrderListResponseDto> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const offset = Math.max(query.offset ?? 0, 0);

    const where: Prisma.ClubVoucherOrderWhereInput = {
      userId: currentContext.user.id,
      status: { not: 'unpaid' },
    };
    if (query.status && query.status !== 'all') {
      where.status = query.status as ClubVoucherOrderStatus;
    }

    // 按状态 Tab 对应的业务时间倒序排序（未知状态回退按下单时间倒序）
    const orderBy =
      VOUCHER_ORDER_SORT_MAP[query.status ?? 'all'] ??
      VOUCHER_ORDER_SORT_MAP.all;

    const orders = await this.prisma.clubVoucherOrder.findMany({
      where,
      orderBy,
      skip: offset,
      take: limit + 1,
    });

    // 惰性过期：pending 且已过期的订单就地转 expired
    const normalized = await this.expireOverdueOrders(orders);

    // 批量补门店名（订单表无外键关系，按 storeId 一次性查询映射）
    const storeNameMap = await this.loadStoreNameMap(
      normalized.map((order) => order.storeId),
    );
    // 批量补商品图片（按 productId 回查营销商品当前图）
    const productImageMap = await this.loadProductImageMap(
      normalized.map((order) => order.productId),
    );

    const items = normalized
      .slice(0, limit)
      .map((order) =>
        toListItem(
          order,
          storeNameMap.get(order.storeId) ?? '',
          productImageMap.get(order.productId) ?? '',
        ),
      );

    return {
      items,
      hasMore: normalized.length > limit,
    };
  }

  /** 按商品 ID 批量查询商品图映射（空数组返回空 Map） */
  private async loadProductImageMap(
    productIds: number[],
  ): Promise<Map<number, string>> {
    const uniqueIds = [...new Set(productIds)].filter((id) => id > 0);
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const products = await this.prisma.marketingProduct.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, image: true },
    });
    return new Map(
      products.map((product) => [product.id, product.image?.trim() ?? '']),
    );
  }

  /** 按门店 ID 批量查询门店名映射（空数组返回空 Map） */
  private async loadStoreNameMap(
    storeIds: number[],
  ): Promise<Map<number, string>> {
    const uniqueIds = [...new Set(storeIds)].filter((id) => id > 0);
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const stores = await this.prisma.store.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, name: true },
    });
    return new Map(stores.map((store) => [store.id, store.name]));
  }

  /** 团购券订单详情（校验归属用户） */
  async getVoucherOrderDetail(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubVoucherOrderDetailDto> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo: orderId, userId: currentContext.user.id },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }
    const normalized = await this.expireIfOverdue(order);
    const storeNameMap = await this.loadStoreNameMap([order.storeId]);
    const productImageMap = await this.loadProductImageMap([order.productId]);
    return toDetailDto(
      normalized,
      storeNameMap.get(order.storeId) ?? '',
      productImageMap.get(order.productId) ?? '',
    );
  }

  /** 按券码查询订单（商家读取/开台核销共用，不限用户） */
  async findByVoucherCode(
    voucherCode: string,
    storeId: number,
  ): Promise<{
    id: number;
    storeId: number;
    productName: string;
    personCount: number | null;
    guestName: string | null;
    guestPhone: string | null;
    guestType: string;
    paidAmountFen: number;
    status: string;
    usedSessionId: number | null;
    quantity: number;
  } | null> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { voucherCode, storeId },
    });
    if (!order) {
      return null;
    }
    const normalized = await this.expireIfOverdue(order);
    return {
      id: normalized.id,
      storeId: normalized.storeId,
      productName: normalized.productName,
      personCount: normalized.personCount,
      guestName: normalized.guestName,
      guestPhone: normalized.guestPhone,
      guestType: normalized.guestType,
      paidAmountFen: normalized.paidAmountFen,
      status: normalized.status,
      usedSessionId: normalized.usedSessionId,
      quantity: normalized.quantity,
    };
  }

  /** 惰性过期批量处理：仅 pending 且 expiresAt 已过的订单转 expired */
  private async expireOverdueOrders<
    T extends { id: number; status: string; expiresAt: Date | null },
  >(orders: T[]): Promise<T[]> {
    const now = new Date();
    const overdueIds = orders
      .filter(
        (order) =>
          order.status === 'pending' &&
          order.expiresAt &&
          order.expiresAt < now,
      )
      .map((order) => order.id);
    if (overdueIds.length > 0) {
      await this.prisma.clubVoucherOrder.updateMany({
        where: { id: { in: overdueIds }, status: 'pending' },
        data: { status: 'expired' },
      });
      return orders.map((order) =>
        overdueIds.includes(order.id) ? { ...order, status: 'expired' } : order,
      );
    }
    return orders;
  }

  /** 单条惰性过期 */
  private async expireIfOverdue<
    T extends { id: number; status: string; expiresAt: Date | null },
  >(order: T): Promise<T> {
    if (
      order.status !== 'pending' ||
      !order.expiresAt ||
      order.expiresAt >= new Date()
    ) {
      return order;
    }
    await this.prisma.clubVoucherOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'expired' },
    });
    return { ...order, status: 'expired' };
  }
}
