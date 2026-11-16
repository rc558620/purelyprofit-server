// 团购券订单查询辅助：常量 / 纯类型 / DTO 映射函数
import type { Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import {
  CLUB_CHANNEL_BALANCE,
  CLUB_CHANNEL_MARKETING_BALANCE,
  CLUB_CHANNEL_WECHAT,
  CLUB_CHANNEL_WECHAT_JSAPI,
} from '../payments/club-payment-channels.constants';
import type { ClubVoucherOrderStatusValue } from './club-voucher-orders.types';
import { encodeClubCursor } from '../shared/club-keyset-cursor.util';

/** 状态 → 展示文案 */
export const STATUS_LABEL_MAP: Record<string, string> = {
  unpaid: '待支付',
  pending: '待使用',
  used: '已使用',
  refunded: '已退款',
  expired: '已过期',
};

/** 支付方式文案 */
export const PAYMENT_METHOD_LABEL_MAP: Record<string, string> = {
  [CLUB_CHANNEL_WECHAT]: '微信支付',
  [CLUB_CHANNEL_WECHAT_JSAPI]: '微信支付',
  [CLUB_CHANNEL_BALANCE]: '储值余额',
  [CLUB_CHANNEL_MARKETING_BALANCE]: '储值余额',
};

/**
 * 单个状态 Tab 的排序声明。
 *
 * `keys` 与 `orderBy` **必须同序同字段**（`orderBy` 末位恒为 id 兜底）：
 * keyset 分页的 WHERE 条件由 `keys` 生成，排序由 `orderBy` 决定，
 * 两者一旦漂移就会出现「排序按 A、过滤按 B」的漏读 / 重读。
 * 该约束由 `club-voucher-order-query.spec.ts` 的断言固化。
 */
/** 可参与券订单排序的字段（限定范围，避免 spec 写入不存在的列） */
export type VoucherOrderSortField =
  | 'createdAt'
  | 'expiresAt'
  | 'usedAt'
  | 'verifyAt'
  | 'refundAt';

/** 券订单排序键：字段名限定在 VoucherOrderSortField 内，可空键按 NULLS LAST */
export interface VoucherOrderSortKey {
  readonly field: VoucherOrderSortField;
  readonly nullable: boolean;
}

export interface VoucherOrderSortSpec {
  /** 游标键（不含 id，id 由 keyset 工具内置兜底） */
  readonly keys: ReadonlyArray<VoucherOrderSortKey>;
  /** Prisma 排序：keys 逐项 DESC（可空键 NULLS LAST）+ id DESC */
  readonly orderBy: Prisma.ClubVoucherOrderOrderByWithRelationInput[];
}

/** 排序键读取器：把 spec 里的字段名映射到行数据，避免在 service 内写 switch */
const VOUCHER_SORT_KEY_READERS: Record<
  VoucherOrderSortField,
  (row: {
    createdAt: Date;
    expiresAt: Date | null;
    usedAt: Date | null;
    verifyAt: Date | null;
    refundAt: Date | null;
  }) => Date | null
> = {
  createdAt: (row) => row.createdAt,
  expiresAt: (row) => row.expiresAt,
  usedAt: (row) => row.usedAt,
  verifyAt: (row) => row.verifyAt,
  refundAt: (row) => row.refundAt,
};

/**
 * 由「本页最后一行」构造下一页游标。
 *
 * 取值顺序严格跟随 spec.keys，保证游标位置与 orderBy 一致；
 * 必须传本页最后一行（不是多取的那一行），否则会跳过一条记录。
 */
export const buildVoucherOrderCursor = (
  spec: VoucherOrderSortSpec,
  row: {
    id: number;
    createdAt: Date;
    expiresAt: Date | null;
    usedAt: Date | null;
    verifyAt: Date | null;
    refundAt: Date | null;
  },
): string =>
  encodeClubCursor(
    spec.keys.map((key) => VOUCHER_SORT_KEY_READERS[key.field](row)),
    row.id,
  );

/**
 * 各状态 Tab 的列表排序：按该状态对应的业务时间倒序（最新发生状态变化的排最前）。
 * - all/pending：按下单时间倒序（pending 自下单起即为该状态）
 * - used：优先按开台核销时间（usedAt），未开台回退用户核销时间（verifyAt），再回退下单时间
 * - refunded：按退款时间倒序，回退下单时间
 * - expired：按过期时间倒序，回退下单时间
 *
 * 每档末位补 `id DESC`：原有排序在三行同秒写入时不构成全序，
 * 游标翻页会在并列值上漏读或重读。
 */
export const VOUCHER_ORDER_SORT_MAP: Record<string, VoucherOrderSortSpec> = {
  all: {
    keys: [{ field: 'createdAt', nullable: false }],
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  },
  pending: {
    keys: [{ field: 'createdAt', nullable: false }],
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  },
  used: {
    keys: [
      { field: 'usedAt', nullable: true },
      { field: 'verifyAt', nullable: true },
      { field: 'createdAt', nullable: false },
    ],
    orderBy: [
      { usedAt: { sort: 'desc', nulls: 'last' } },
      { verifyAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
  },
  refunded: {
    keys: [
      { field: 'refundAt', nullable: true },
      { field: 'createdAt', nullable: false },
    ],
    orderBy: [
      { refundAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
  },
  expired: {
    keys: [
      { field: 'expiresAt', nullable: true },
      { field: 'createdAt', nullable: false },
    ],
    orderBy: [
      { expiresAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
  },
};

/**
 * 展示态派生：pending 且已过有效期 → expired。
 *
 * 读路径不再写库（过期翻转由 `club-voucher-order-expiry` 定时任务承担），
 * 但「过期券不可用」的语义由核销 / 退款链路各自按 `expiresAt` 独立拦截，
 * 因此这里只做展示口径派生，与定时任务的条件完全一致（status=pending 且 expiresAt<now）。
 */
export const deriveVoucherOrderStatus = (
  status: string,
  expiresAt: Date | null,
  now: Date,
): string =>
  status === 'pending' && expiresAt !== null && expiresAt < now
    ? 'expired'
    : status;

/** 时间格式：YYYY-MM-DD HH:mm（上海时区固定偏移） */
export const formatDateTime = (date: Date): string => {
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
export const formatDate = (date: Date): string =>
  formatDateTime(date).slice(0, 10);

/** 团购券订单查询返回的列表字段 */
export type VoucherOrderListItem = {
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

/** 状态值守卫（兜底返回 pending） */
export const toStatusValue = (status: string): ClubVoucherOrderStatusValue => {
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
};

/** 订单实体 → 列表条目 */
export const toListItem = (
  order: VoucherOrderListItem,
  storeName: string,
  image: string,
) => ({
  orderNo: order.orderNo,
  voucherCode: order.voucherCode ?? undefined,
  platform: order.platform,
  productName: order.productName,
  quantity: order.quantity,
  personCount: order.personCount ?? undefined,
  originalAmountFen: order.originalAmountFen,
  discountAmountFen: order.discountAmountFen,
  paidAmountFen: order.paidAmountFen,
  status: toStatusValue(order.status),
  statusLabel: STATUS_LABEL_MAP[order.status] ?? order.status,
  storeName,
  image: image || undefined,
  expireDate: order.expiresAt ? formatDate(order.expiresAt) : undefined,
  createdAtLabel: formatDateTime(order.createdAt),
});

/** 详情 DTO：补充门店名/支付方式/核销与退款信息 */
export const toDetailDto = (
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
    pointsUsed: number;
    remark: string | null;
    breakdownItems: Prisma.JsonValue | null;
  },
  storeName: string,
  image: string,
) => {
  const base = toListItem(order, storeName, image);
  return {
    ...base,
    verifyAt: order.verifyAt ? formatDateTime(order.verifyAt) : undefined,
    usedAt: order.usedAt ? formatDateTime(order.usedAt) : undefined,
    usedStoreName: undefined,
    refundAt: order.refundAt ? formatDateTime(order.refundAt) : undefined,
    refundAmountFen: order.refundAmountFen ?? undefined,
    // 返还积分数：退款时原路返还给顾客（前端仅展示，不做计算）
    pointsUsed: order.pointsUsed,
    paymentMethodLabel:
      PAYMENT_METHOD_LABEL_MAP[order.paymentChannel] ?? order.paymentChannel,
    orderId: order.orderNo,
    orderTimeLabel: formatDateTime(order.createdAt),
    // 下单备注：顾客填写，空串归一为 undefined（前端为空不展示）
    remark: order.remark ?? undefined,
    // 优惠拆解展示行：优先取落库快照（与服务详情页一致），历史订单降级为汇总三行
    breakdownItems: toDetailBreakdownItems(order),
  };
};

/** 优惠拆解展示行：快照缺失时按汇总金额生成降级行（应付/已优惠/实付） */
export const toDetailBreakdownItems = (order: {
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
}> => {
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
      // 旧版快照补齐：缺"原价"行时置顶插入（划线），订单用了积分且缺"积分抵扣"行时追加
      const hasOriginalPrice = rows.some((row) => row.id === 'original-price');
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
};
