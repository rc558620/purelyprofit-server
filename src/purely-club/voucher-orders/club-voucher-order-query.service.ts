// 团购券订单查询服务：列表/详情 + 惰性过期 + 状态文案映射
import { BadRequestException, Injectable } from '@nestjs/common';
import type { ClubVoucherOrderStatus, Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE } from './club-voucher-orders.constants';
import type {
  ClubVoucherOrderDetailDto,
  ClubVoucherOrderItemDto,
  ClubVoucherOrderListResponseDto,
} from './dto/club-voucher-order.dto';

/** 状态 → 展示文案 */
const STATUS_LABEL_MAP: Record<string, string> = {
  unpaid: '待支付',
  pending: '待使用',
  used: '已使用',
  refunded: '已退款',
  expired: '已过期',
};

/** 支付方式文案 */
const PAYMENT_METHOD_LABEL_MAP: Record<string, string> = {
  wechat: '微信支付',
  balance: '储值余额',
};

/** 时间格式：YYYY-MM-DD HH:mm（上海时区固定偏移） */
const formatDateTime = (date: Date): string => {
  const shanghai = new Date(date.getTime() + 8 * 60 * 60_000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    shanghai.getUTCFullYear(),
    '-',
    pad(shanghai.getUTCMonth() + 1),
    '-',
    pad(shanghai.getUTCDate()),
    ' ',
    pad(shanghai.getUTCHours()),
    ':',
    pad(shanghai.getUTCMinutes()),
  ].join('');
};

/** 时间格式：YYYY-MM-DD */
const formatDate = (date: Date): string => formatDateTime(date).slice(0, 10);

/** 团购券订单查询返回的列表字段 */
type VoucherOrderListItem = {
  id: number;
  orderNo: string;
  voucherCode: string | null;
  platform: string;
  productName: string;
  quantity: number;
  personCount: number | null;
  originalAmountFen: number;
  discountAmountFen: number;
  paidAmountFen: number;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
};

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

    const orders = await this.prisma.clubVoucherOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
        this.toListItem(
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
    return this.toDetailDto(
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

  /** 订单实体 → 列表条目 */
  private toListItem(
    order: VoucherOrderListItem,
    storeName: string,
    image: string,
  ): ClubVoucherOrderItemDto {
    return {
      orderNo: order.orderNo,
      voucherCode: order.voucherCode ?? undefined,
      platform: order.platform,
      productName: order.productName,
      quantity: order.quantity,
      personCount: order.personCount ?? undefined,
      originalAmountFen: order.originalAmountFen,
      discountAmountFen: order.discountAmountFen,
      paidAmountFen: order.paidAmountFen,
      status: this.toStatusValue(order.status),
      statusLabel: STATUS_LABEL_MAP[order.status] ?? order.status,
      storeName,
      image: image || undefined,
      expireDate: order.expiresAt ? formatDate(order.expiresAt) : undefined,
      createdAtLabel: formatDateTime(order.createdAt),
    };
  }

  /** 详情 DTO：补充门店名/支付方式/核销与退款信息 */
  private toDetailDto(
    order: {
      id: number;
      orderNo: string;
      voucherCode: string | null;
      platform: string;
      storeId: number;
      productName: string;
      quantity: number;
      personCount: number | null;
      originalAmountFen: number;
      discountAmountFen: number;
      paidAmountFen: number;
      status: string;
      expiresAt: Date | null;
      createdAt: Date;
      paymentChannel: string;
      verifyAt: Date | null;
      usedAt: Date | null;
      usedStoreId: number | null;
      refundAt: Date | null;
      refundAmountFen: number | null;
      pointsDeductFen: number;
      breakdownItems: Prisma.JsonValue | null;
    },
    storeName: string,
    image: string,
  ): ClubVoucherOrderDetailDto {
    const base = this.toListItem(order, storeName, image);
    return {
      ...base,
      verifyAt: order.verifyAt ? formatDateTime(order.verifyAt) : undefined,
      usedAt: order.usedAt ? formatDateTime(order.usedAt) : undefined,
      usedStoreName: undefined,
      refundAt: order.refundAt ? formatDateTime(order.refundAt) : undefined,
      refundAmountFen: order.refundAmountFen ?? undefined,
      paymentMethodLabel:
        PAYMENT_METHOD_LABEL_MAP[order.paymentChannel] ?? order.paymentChannel,
      orderId: order.orderNo,
      orderTimeLabel: formatDateTime(order.createdAt),
      // 优惠拆解展示行：优先取落库快照（与服务详情页一致），历史订单降级为汇总三行
      breakdownItems: this.toDetailBreakdownItems(order),
    };
  }

  /** 优惠拆解展示行：快照缺失时按汇总金额生成降级行（应付/已优惠/实付） */
  private toDetailBreakdownItems(order: {
    originalAmountFen: number;
    discountAmountFen: number;
    paidAmountFen: number;
    pointsDeductFen: number;
    breakdownItems: Prisma.JsonValue | null;
  }): Array<{
    id: string;
    label: string;
    value: string;
    isDeduction: boolean;
    isStrikethrough: boolean;
  }> {
    const toYuan = (fen: number): string =>
      Money.fromDbCents(fen).toFixedOutputYuan();
    const snapshot = order.breakdownItems;
    if (Array.isArray(snapshot)) {
      const items = (snapshot as unknown[]).filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      );
      if (items.length > 0) {
        // 快照行字段可能来自任意 JSON，统一按字符串安全读取
        const toText = (value: unknown): string =>
          typeof value === 'string' ? value : '';
        const rows = items.map((item) => ({
          id: toText(item.id),
          label: toText(item.label),
          value: toText(item.value),
          isDeduction: item.isDeduction === true,
          isStrikethrough: item.isStrikethrough === true,
        }));
        // 旧版快照补齐：缺“原价”行时置顶插入（划线），订单用了积分且缺“积分抵扣”行时追加
        const hasOriginalPrice = rows.some(
          (row) => row.id === 'original-price',
        );
        if (!hasOriginalPrice) {
          rows.unshift({
            id: 'original-price',
            label: '原价',
            value: `¥${toYuan(order.originalAmountFen)}`,
            isDeduction: false,
            isStrikethrough: true,
          });
        }
        if (
          order.pointsDeductFen > 0 &&
          !rows.some((row) => row.id === 'points')
        ) {
          rows.push({
            id: 'points',
            label: '积分抵扣',
            value: `-¥${toYuan(order.pointsDeductFen)}`,
            isDeduction: true,
            isStrikethrough: false,
          });
        }
        return rows;
      }
    }
    // 已优惠 = 应付（原价）- 实付：完整优惠口径（历史订单存储的 discountAmountFen 可能缺会员价差，不采用）
    const totalDiscountFen = Math.max(
      order.originalAmountFen - order.paidAmountFen,
      0,
    );
    return [
      {
        id: 'payable',
        label: '应付金额',
        value: `¥${toYuan(order.originalAmountFen)}`,
        isDeduction: false,
        isStrikethrough: false,
      },
      {
        id: 'discount',
        label: '已优惠',
        value: `-¥${toYuan(totalDiscountFen)}`,
        isDeduction: true,
        isStrikethrough: false,
      },
      {
        id: 'paid',
        label: '实付款',
        value: `¥${toYuan(order.paidAmountFen)}`,
        isDeduction: false,
        isStrikethrough: false,
      },
    ];
  }

  private toStatusValue(
    status: string,
  ): 'unpaid' | 'pending' | 'used' | 'refunded' | 'expired' {
    if (
      status === 'unpaid' ||
      status === 'pending' ||
      status === 'used' ||
      status === 'refunded' ||
      status === 'expired'
    ) {
      return status;
    }
    return 'pending';
  }
}
