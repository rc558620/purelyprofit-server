// 团购券订单查询服务：列表/详情 + 惰性过期
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CLUB_VOUCHER_ERROR_CODE,
  clubVoucherError,
} from './club-voucher-orders.errors';
import type { ClubVoucherOrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE } from './club-voucher-orders.constants';
import {
  buildVoucherOrderCursor,
  deriveVoucherOrderStatus,
  toDetailDto,
  toListItem,
  VOUCHER_ORDER_SORT_MAP,
} from './club-voucher-order-query.helper';
import type {
  ClubVoucherOrderDetailDto,
  ClubVoucherOrderListResponseDto,
} from './dto/club-voucher-order.dto';
import {
  buildClubKeysetWhere,
  decodeClubCursor,
} from '../shared/club-keyset-cursor.util';

/**
 * 读路径字段白名单：订单表含 breakdownItems Json 与多处文本快照，全字段查询会在
 * 高频列表上产生大量无效回表与反序列化开销。按各出口 DTO 实际消费字段裁剪，
 * 增删 DTO 字段时必须同步维护这里（列表页与商详页共用基础字段）。
 */
const VOUCHER_ORDER_LIST_SELECT = {
  id: true,
  storeId: true,
  productId: true,
  orderNo: true,
  voucherCode: true,
  platform: true,
  productName: true,
  quantity: true,
  personCount: true,
  originalAmountFen: true,
  discountAmountFen: true,
  paidAmountFen: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  // 排序键列：仅用于构造 keyset 游标（不回传前端），三种状态 Tab 各用其中一列
  usedAt: true,
  verifyAt: true,
  refundAt: true,
} satisfies Prisma.ClubVoucherOrderSelect;

/** 详情在列表字段基础上补齐支付/核销/退款信息（breakdownItems 仅详情需要） */
const VOUCHER_ORDER_DETAIL_SELECT = {
  ...VOUCHER_ORDER_LIST_SELECT,
  paymentChannel: true,
  verifyAt: true,
  usedAt: true,
  usedStoreId: true,
  refundAt: true,
  refundAmountFen: true,
  pointsDeductFen: true,
  pointsUsed: true,
  remark: true,
  breakdownItems: true,
} satisfies Prisma.ClubVoucherOrderSelect;

/** 按券码读取（商家开台/核销共用）：只取调用方契约中的字段 */
const VOUCHER_ORDER_CODE_SELECT = {
  id: true,
  storeId: true,
  productName: true,
  personCount: true,
  guestName: true,
  guestPhone: true,
  guestType: true,
  paidAmountFen: true,
  status: true,
  expiresAt: true,
  usedSessionId: true,
  quantity: true,
} satisfies Prisma.ClubVoucherOrderSelect;

@Injectable()
export class ClubVoucherOrderQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** 我的团购券订单列表（状态筛选 + keyset 游标分页） */
  async listVoucherOrders(
    currentContext: ClubCurrentContext,
    query: { status?: string; limit?: number; cursor?: string },
  ): Promise<ClubVoucherOrderListResponseDto> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const now = new Date();
    // 按状态 Tab 对应的业务时间倒序排序（未知状态回退按下单时间倒序）
    const sortSpec =
      VOUCHER_ORDER_SORT_MAP[query.status ?? 'all'] ??
      VOUCHER_ORDER_SORT_MAP.all;
    const position = decodeClubCursor(query.cursor, sortSpec.keys);

    const where = this.buildListWhere(
      currentContext.user.id,
      query.status,
      now,
      position
        ? buildClubKeysetWhere<Prisma.ClubVoucherOrderWhereInput>(
            sortSpec.keys,
            position,
          )
        : null,
    );

    const rows = await this.prisma.clubVoucherOrder.findMany({
      where,
      orderBy: sortSpec.orderBy,
      // 多取一行判断是否还有下一页（游标由本页最后一行编码）
      take: limit + 1,
      select: VOUCHER_ORDER_LIST_SELECT,
    });

    // 读接口不再写库：过期只在展示层派生，翻转由 club-voucher-order-expiry 定时任务承担
    const normalized = rows.map((order) => ({
      ...order,
      status: deriveVoucherOrderStatus(order.status, order.expiresAt, now),
    }));
    // 两次批量补映射互不依赖（仍各自 in 批量查询，避免 N+1），并行发出省一次往返
    const pageRows = normalized.slice(0, limit);
    const [storeNameMap, productImageMap] = await Promise.all([
      this.loadStoreNameMap(pageRows.map((order) => order.storeId)),
      this.loadProductImageMap(pageRows.map((order) => order.productId)),
    ]);

    const items = pageRows.map((order) =>
      toListItem(
        order,
        storeNameMap.get(order.storeId) ?? '',
        productImageMap.get(order.productId) ?? '',
      ),
    );

    return {
      items,
      hasMore: normalized.length > limit,
      nextCursor:
        normalized.length > limit && pageRows.length > 0
          ? buildVoucherOrderCursor(sortSpec, pageRows[pageRows.length - 1])
          : null,
    };
  }

  /**
   * 列表 WHERE：归属过滤 + 状态筛选 + 游标条件。
   *
   * 状态筛选在 expired / pending 两档本身就是 OR 结构，游标条件（多级排序键）也是 OR，
   * 直接平铺到同一个对象会互相覆盖，必须用 AND 数组串起来。
   */
  private buildListWhere(
    userId: number,
    status: string | undefined,
    now: Date,
    cursorWhere: Prisma.ClubVoucherOrderWhereInput | null,
  ): Prisma.ClubVoucherOrderWhereInput {
    const base: Prisma.ClubVoucherOrderWhereInput = {
      userId,
      status: { not: 'unpaid' },
    };
    if (status && status !== 'all') {
      if (status === 'expired') {
        // 「已过期」不能只按 DB 的 expired 状态查：翻转由定时任务承担（最短几秒、最长一个
        // 任务周期），此期间老单仍是 pending。这里直接按 expiresAt 取并集，保证 Tab 完整。
        base.OR = [
          { status: 'expired' as ClubVoucherOrderStatus },
          {
            status: 'pending' as ClubVoucherOrderStatus,
            expiresAt: { lt: now },
          },
        ];
      } else if (status === 'pending') {
        // 对称地：「待使用」要排除已到有效期但尚未翻转的单，避免首页混入已过期券
        base.OR = [
          { status: 'pending' as ClubVoucherOrderStatus, expiresAt: null },
          {
            status: 'pending' as ClubVoucherOrderStatus,
            expiresAt: { gte: now },
          },
        ];
      } else {
        base.status = status as ClubVoucherOrderStatus;
      }
    }
    return cursorWhere ? { AND: [base, cursorWhere] } : base;
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
      select: VOUCHER_ORDER_DETAIL_SELECT,
    });
    if (!order) {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
          CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
        ),
      );
    }
    // 读路径不写库：过期仅在展示层派生（核销 / 退款链路各自按 expiresAt 独立拦截）
    const normalized = {
      ...order,
      status: deriveVoucherOrderStatus(
        order.status,
        order.expiresAt,
        new Date(),
      ),
    };
    const [storeNameMap, productImageMap] = await Promise.all([
      this.loadStoreNameMap([order.storeId]),
      this.loadProductImageMap([order.productId]),
    ]);
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
      select: VOUCHER_ORDER_CODE_SELECT,
    });
    if (!order) {
      return null;
    }
    // 与列表/详情同口径：过期只在返回态派生，读路径不写库
    const normalized = {
      ...order,
      status: deriveVoucherOrderStatus(
        order.status,
        order.expiresAt,
        new Date(),
      ),
    };
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
}
