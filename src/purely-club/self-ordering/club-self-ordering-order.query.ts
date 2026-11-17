// 自助下单订单读侧契约：字段白名单 + 游标排序键 + 列表查询计划与分页组装
//
// 从 ClubSelfOrderingOrderService 拆出的原因：字段白名单、排序键与游标 spec 是
// 「前端响应契约」的一部分，任何列表口径调整都只应改动这一处；留在建单 service
// 里时，一次列表投影变更会被混进幂等与事务代码中，回归面被放大。
import type { Prisma } from '@prisma/client';
import { resolveCursorLimit } from '../../shared/cursor-pagination.utils';
import {
  buildClubKeysetWhere,
  decodeClubCursor,
  encodeClubCursor,
  type ClubCursorKeySpec,
} from '../shared/club-keyset-cursor.util';
import type { ListSelfOrdersQueryDto } from './dto/list-self-orders.dto';
import {
  SELF_ORDER_LIST_DEFAULT_LIMIT,
  SELF_ORDER_LIST_MAX_LIMIT,
} from './dto/list-self-orders.dto';
import { toSelfOrderResponse } from './club-self-ordering-order.mapper';

/**
 * 历史列表字段白名单：显式列出前端契约需要的列。
 *
 * 改前用 `include: { items: true }` 会把订单整行（含幂等键、删除标记等
 * 内部字段）和商品行整行全部拉回再丢弃，50 条时属于明显的无效 IO。
 */
export const SELF_ORDER_LIST_SELECT = {
  id: true,
  orderNo: true,
  storeId: true,
  sessionId: true,
  spaceId: true,
  remark: true,
  itemTotalAmount: true,
  payableAmount: true,
  status: true,
  paymentStatus: true,
  version: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      productName: true,
      categoryName: true,
      salePrice: true,
      quantity: true,
      specSignature: true,
    },
  },
} as const satisfies Prisma.SelfOrderSelect;

/** 白名单投影后的订单行（详情 / 列表 / 建单回放共用同一结构） */
export type SelfOrderRow = Prisma.SelfOrderGetPayload<{
  select: typeof SELF_ORDER_LIST_SELECT;
}>;

/**
 * 历史列表排序键：`createdAt` 落库即固定，配 `id` 兜底构成全序，
 * 保证翻页不漏不重（同一事务内写入的多行 createdAt 相同）。
 */
const SELF_ORDER_LIST_CURSOR_KEYS: ReadonlyArray<ClubCursorKeySpec> = [
  { field: 'createdAt', nullable: false },
];

/** 历史列表排序（与 SELF_ORDER_LIST_CURSOR_KEYS 同序） */
const SELF_ORDER_LIST_ORDER_BY: Prisma.SelfOrderOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

/** 一页历史订单的查询计划（多取一行判断是否还有下一页） */
export interface SelfOrderListPlan {
  readonly where: Prisma.SelfOrderWhereInput;
  readonly orderBy: Prisma.SelfOrderOrderByWithRelationInput[];
  readonly limit: number;
}

/**
 * 组装会话维度历史订单的查询条件：归属 + 会话 + 未删除 + keyset 游标。
 *
 * 改造前是 `take: 50` 硬上限且返回裸数组：超过 50 笔之后更早的订单永远拿不到，
 * 前端也没有「还有更多」的依据。改为 keyset 游标后深翻页成本恒定。
 */
export function planSelfOrderList(
  actorId: number,
  query: ListSelfOrdersQueryDto,
): SelfOrderListPlan {
  const limit = resolveCursorLimit(query.limit, {
    defaultLimit: SELF_ORDER_LIST_DEFAULT_LIMIT,
    maxLimit: SELF_ORDER_LIST_MAX_LIMIT,
  });
  const position = decodeClubCursor(query.cursor, SELF_ORDER_LIST_CURSOR_KEYS);

  const where: Prisma.SelfOrderWhereInput = {
    sessionId: query.sessionId,
    clubUserId: actorId,
    deletedAt: null,
    ...(position
      ? buildClubKeysetWhere<Prisma.SelfOrderWhereInput>(
          SELF_ORDER_LIST_CURSOR_KEYS,
          position,
        )
      : {}),
  };

  return { where, orderBy: SELF_ORDER_LIST_ORDER_BY, limit };
}

/** 一页历史订单的响应体：条目 + 下一页游标 + 是否还有更多 */
export interface SelfOrderListPage {
  items: Record<string, unknown>[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 由「多取一行」的结果切片组装分页响应，并提供下一页游标 */
export function buildSelfOrderListPage(
  rows: readonly SelfOrderRow[],
  limit: number,
): SelfOrderListPage {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;

  return {
    items: pageRows.map((order) => toSelfOrderResponse(order)),
    nextCursor:
      hasMore && lastRow
        ? encodeClubCursor([lastRow.createdAt], lastRow.id)
        : null,
    hasMore,
  };
}
