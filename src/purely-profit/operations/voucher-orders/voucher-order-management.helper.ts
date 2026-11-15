// 商家端团购券订单管理：查询白名单、状态常量、时间范围与响应映射（纯逻辑，不持有数据库依赖）
import { BadRequestException } from '@nestjs/common';
import type { ClubVoucherOrderStatus, Prisma } from '@prisma/client';
import { resolveClubGuestDisplayName } from '../../auth/auth.utils';
import {
  addShanghaiDays,
  getShanghaiDayStartMs,
  makeShanghaiMs,
} from '../../../shared/shanghai-time.utils';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
  resolveCursorLimit,
} from '../../../shared/cursor-pagination.utils';
import type {
  QueryVoucherOrdersDto,
  VoucherOrderListItemDto,
} from './dto/voucher-order-management.dto';
import {
  VoucherOrderStatusFilter,
  VoucherOrderTimePreset,
} from './dto/voucher-order-management.dto';

/** 商家端确认操作结果 */
export interface VoucherOrderConfirmResult {
  orderNo: string;
  /** 确认时间 ISO */
  confirmedAt: string;
  /** 确认操作员姓名 */
  confirmedByStaffName: string | null;
  /** 确认操作员角色快照（owner=主账号/manager=店长/staff=收银员） */
  confirmedByStaffRole: 'owner' | 'manager' | 'staff' | null;
  /** 当前订单状态（确认不改变状态，仍为 pending） */
  status: 'pending';
}

/** 商家端拒绝操作结果 */
export interface VoucherOrderRejectResult {
  orderNo: string;
  status: 'refunded';
  refundAt: string;
  rejectedAt: string;
  rejectedByStaffName: string | null;
  /** 拒绝操作员角色快照（owner=主账号/manager=店长/staff=收银员） */
  rejectedByStaffRole: 'owner' | 'manager' | 'staff' | null;
}

/** 可操作状态：确认/拒绝仅对 pending 订单开放 */
export const CONFIRMABLE_STATUS = ['pending'] as const;

/**
 * 商家端列表可见状态：显式列举，替代 `status: { not: 'unpaid' }`。
 * `not` 是不等式，会让 [storeId, status, createdAt] 复合索引退化到只用 storeId
 * 前缀；`in` 让 PG 按各状态值分别走索引范围扫描，findMany 与 count 同时受益。
 */
export const MERCHANT_VISIBLE_STATUSES = [
  'pending',
  'used',
  'refunded',
  'expired',
] as const satisfies readonly ClubVoucherOrderStatus[];

/** 惰性过期单批翻转上限：限制单次 UPDATE 的行数与持锁时间 */
export const EXPIRE_SCAN_BATCH_SIZE = 200;

/** 单次列表请求最多处理的批次，剩余订单留到下次请求，避免长事务 */
export const EXPIRE_SCAN_MAX_BATCHES = 10;

/** 列表默认每页条数（与 DTO 示例保持一致） */
export const VOUCHER_ORDER_LIST_DEFAULT_LIMIT = 20;

/**
 * 列表单页上限：沿用迁移前的 limit 上限。
 *
 * 前端「静默刷新按已加载条数重拉」依赖这个硬上限，迁移期不得放大。
 */
export const VOUCHER_ORDER_LIST_MAX_LIMIT = 100;

/**
 * 列表排序：`createdAt` 可能同秒（批量回放/导入），必须以 `id` 兜底，
 * 否则同值行在游标翻页时会漏读或重复读；方向与 `[storeId, status, createdAt]`
 * 索引一致，等值前缀仍能走索引范围扫描。
 */
export const VOUCHER_ORDER_MANAGE_ORDER_BY = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.ClubVoucherOrderOrderByWithRelationInput[];

/** 列表游标内容：上一页最后一条的排序键 + 主键 */
export interface VoucherOrderListCursor {
  createdAt: Date;
  id: number;
}

/** 列表分页参数归一结果 */
export interface VoucherOrderListPaging {
  /** 实际生效的每页条数（已按上限钳制） */
  limit: number;
  /** 兼容期 offset：仅在未传 cursor 时生效 */
  offset: number;
  /** 游标：null 表示第一页或走 offset 兼容路径 */
  cursor: VoucherOrderListCursor | null;
}

/** 编码列表游标（前端原样回传 nextCursor 即可） */
export const encodeVoucherOrderCursor = (row: {
  createdAt: Date;
  id: number;
}): string => encodeCursor({ keys: [row.createdAt.getTime()], id: row.id });

/** 解码列表游标：空值视为第一页，格式非法由公共解码器抛 400 */
export const decodeVoucherOrderCursor = (
  raw?: string | null,
): VoucherOrderListCursor | null => {
  const payload = decodeCursor(raw);
  if (!payload) {
    return null;
  }
  const [createdAtMs] = payload.keys;
  if (
    typeof createdAtMs !== 'number' ||
    !Number.isSafeInteger(createdAtMs) ||
    createdAtMs <= 0
  ) {
    throw new BadRequestException(CURSOR_INVALID_MESSAGE);
  }
  return { createdAt: new Date(createdAtMs), id: payload.id };
};

/** 分页参数归一：cursor 优先，缺省回退 offset（兼容期双路径并存） */
export const resolveVoucherOrderListPaging = (
  query: QueryVoucherOrdersDto,
): VoucherOrderListPaging => ({
  limit: resolveCursorLimit(query.limit, {
    defaultLimit: VOUCHER_ORDER_LIST_DEFAULT_LIMIT,
    maxLimit: VOUCHER_ORDER_LIST_MAX_LIMIT,
  }),
  offset: Math.max(query.offset ?? 0, 0),
  cursor: decodeVoucherOrderCursor(query.cursor),
});

/**
 * 游标条件：只保留严格排在游标之后的行。
 *
 * 用 OR 展开而不是 `(createdAt, id) < (?, ?)`：Prisma 没有 row-value 比较，
 * 而为游标引入原生 SQL 会多出一份注入面与方言耦合。同刻行数极少，两个分支足够。
 */
export const buildVoucherOrderCursorWhere = (
  cursor: VoucherOrderListCursor,
): Prisma.ClubVoucherOrderWhereInput => ({
  OR: [
    { createdAt: { lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
  ],
});

/**
 * 商家端列表字段白名单：按 VoucherOrderListItemDto 实际消费字段裁剪，避免高频
 * 列表回读 breakdownItems Json 与微信/积分等无关快照列；商品图仍按当前商品实时取。
 */
export const VOUCHER_ORDER_MANAGE_LIST_SELECT = {
  // 主键不进 DTO，但游标要编码它做 tie-breaker，因此必须随列表取回
  id: true,
  orderNo: true,
  voucherCode: true,
  guestName: true,
  guestPhone: true,
  categoryName: true,
  productName: true,
  quantity: true,
  remark: true,
  paidAmountFen: true,
  status: true,
  usedSessionId: true,
  createdAt: true,
  confirmedAt: true,
  verifyAt: true,
  confirmedByStaffName: true,
  confirmedByStaffRole: true,
  rejectedAt: true,
  refundAt: true,
  rejectedByStaffName: true,
  rejectedByStaffRole: true,
  product: { select: { image: true } },
} satisfies Prisma.ClubVoucherOrderSelect;

/** 确认链路字段白名单：只用状态/有效期/确认快照，不回读 breakdownItems 等大列 */
export const VOUCHER_ORDER_CONFIRM_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  expiresAt: true,
  confirmedAt: true,
  confirmedByStaffName: true,
  confirmedByStaffRole: true,
} satisfies Prisma.ClubVoucherOrderSelect;

/** 列表查询行类型（由 select 白名单推导，增删字段自动同步） */
export type VoucherOrderManageListRow = Prisma.ClubVoucherOrderGetPayload<{
  select: typeof VOUCHER_ORDER_MANAGE_LIST_SELECT;
}>;

/** 确认预读行类型 */
export type VoucherOrderConfirmRow = Prisma.ClubVoucherOrderGetPayload<{
  select: typeof VOUCHER_ORDER_CONFIRM_SELECT;
}>;

/** 时间筛选：date（YYYY-MM-DD）优先，其次 preset（today/7d/30d，默认 today） */
export const buildTimeRange = (
  query: QueryVoucherOrdersDto,
): { gte: Date; lte: Date } | null => {
  if (query.date) {
    const [yearText, monthText, dayText] = query.date.split('-');
    const startAt = new Date(
      makeShanghaiMs(Number(yearText), Number(monthText) - 1, Number(dayText)),
    );
    if (Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('日期格式不正确');
    }
    return {
      gte: startAt,
      lte: new Date(
        makeShanghaiMs(
          Number(yearText),
          Number(monthText) - 1,
          Number(dayText),
          23,
          59,
          59,
          999,
        ),
      ),
    };
  }

  const now = new Date();
  const endAt = new Date(getShanghaiDayStartMs(now.getTime()) + 86_400_000 - 1);
  const startAt = new Date(getShanghaiDayStartMs(now.getTime()));
  const preset = query.preset ?? VoucherOrderTimePreset.TODAY;
  if (preset === VoucherOrderTimePreset.DAYS_7) {
    return {
      gte: new Date(addShanghaiDays(startAt.getTime(), -6)),
      lte: endAt,
    };
  }
  if (preset === VoucherOrderTimePreset.DAYS_30) {
    return {
      gte: new Date(addShanghaiDays(startAt.getTime(), -29)),
      lte: endAt,
    };
  }
  return { gte: startAt, lte: endAt };
};

/**
 * 列表筛选条件（**不含游标**）：列表与 count 共用同一份对象。
 *
 * total 必须是全量口径：一旦把游标条件带进 count，翻页时 total 会一路变小，
 * 前端「已显示全部 N 条」与 hasMore 判定都会失真。
 */
export const buildVoucherOrderListWhere = (
  storeId: number,
  query: QueryVoucherOrdersDto,
): Prisma.ClubVoucherOrderWhereInput => {
  const timeRange = buildTimeRange(query);
  return {
    storeId,
    // 未支付草稿单（用户弃付）不进商家端列表：与用户端列表口径一致
    status: { in: [...MERCHANT_VISIBLE_STATUSES] },
    ...(query.status && query.status !== VoucherOrderStatusFilter.ALL
      ? { status: query.status }
      : {}),
    ...(timeRange ? { createdAt: timeRange } : {}),
    // 关键词搜索：匹配订单号、买家姓名、券码（与前端搜索框契约一致）。
    // 这里的 OR 与游标条件的 OR 不同层：游标条件由调用方包进 AND，避免互相覆盖。
    ...(query.keyword
      ? {
          OR: [
            { orderNo: { contains: query.keyword, mode: 'insensitive' } },
            { guestName: { contains: query.keyword, mode: 'insensitive' } },
            { voucherCode: { contains: query.keyword, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
};

/** 订单实体 → 列表项（时间为 ISO 字符串，金额保持分单位） */
export const toListItem = (
  row: VoucherOrderManageListRow,
): VoucherOrderListItemDto => {
  return {
    orderNo: row.orderNo,
    voucherCode: row.voucherCode,
    // 历史订单姓名快照可能为空（静默微信注册无昵称）：按快照手机号兜底派生展示名
    guestName: resolveClubGuestDisplayName(row.guestName, row.guestPhone),
    guestPhone: row.guestPhone,
    categoryName: row.categoryName,
    productName: row.productName,
    productImage: row.product.image,
    quantity: row.quantity,
    remark: row.remark,
    paidAmountFen: row.paidAmountFen,
    status: row.status as VoucherOrderListItemDto['status'],
    usedSessionId: row.usedSessionId,
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    verifyAt: row.verifyAt?.toISOString() ?? null,
    confirmedByStaffName: row.confirmedByStaffName,
    confirmedByStaffRole:
      row.confirmedByStaffRole as VoucherOrderListItemDto['confirmedByStaffRole'],
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    refundAt: row.refundAt?.toISOString() ?? null,
    rejectedByStaffName: row.rejectedByStaffName,
    rejectedByStaffRole:
      row.rejectedByStaffRole as VoucherOrderListItemDto['rejectedByStaffRole'],
  };
};

/** 确认结果映射：幂等分支与并发抢占回读分支共用 */
export const toConfirmResult = (
  order: Pick<
    VoucherOrderConfirmRow,
    'orderNo' | 'confirmedByStaffName' | 'confirmedByStaffRole'
  >,
  confirmedAt: Date,
): VoucherOrderConfirmResult => ({
  orderNo: order.orderNo,
  confirmedAt: confirmedAt.toISOString(),
  confirmedByStaffName: order.confirmedByStaffName,
  confirmedByStaffRole:
    order.confirmedByStaffRole as VoucherOrderConfirmResult['confirmedByStaffRole'],
  status: 'pending',
});
