// 商家端团购券订单管理：查询白名单、状态常量、时间范围与响应映射（纯逻辑，不持有数据库依赖）
import { BadRequestException } from '@nestjs/common';
import type { ClubVoucherOrderStatus, Prisma } from '@prisma/client';
import { resolveClubGuestDisplayName } from '../../auth/auth.utils';
import {
  addShanghaiDays,
  getShanghaiDayStartMs,
  makeShanghaiMs,
} from '../../../shared/shanghai-time.utils';
import type {
  QueryVoucherOrdersDto,
  VoucherOrderListItemDto,
} from './dto/voucher-order-management.dto';
import { VoucherOrderTimePreset } from './dto/voucher-order-management.dto';

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

/**
 * 商家端列表字段白名单：按 VoucherOrderListItemDto 实际消费字段裁剪，避免高频
 * 列表回读 breakdownItems Json 与微信/积分等无关快照列；商品图仍按当前商品实时取。
 */
export const VOUCHER_ORDER_MANAGE_LIST_SELECT = {
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
