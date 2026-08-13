// 团购券订单查询辅助：常量 / 纯类型 / DTO 映射函数
import type { Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import type { ClubVoucherOrderStatusValue } from './club-voucher-orders.types';

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
  wechat: '微信支付',
  balance: '储值余额',
};

/**
 * 各状态 Tab 的列表排序：按该状态对应的业务时间倒序（最新发生状态变化的排最前）。
 * - all/pending：按下单时间倒序（pending 自下单起即为该状态）
 * - used：优先按开台核销时间（usedAt），未开台回退用户核销时间（verifyAt），再回退下单时间
 * - refunded：按退款时间倒序，回退下单时间
 * - expired：按过期时间倒序，回退下单时间
 */
export const VOUCHER_ORDER_SORT_MAP: Record<
  string,
  Prisma.ClubVoucherOrderOrderByWithRelationInput[]
> = {
  all: [{ createdAt: 'desc' }],
  pending: [{ createdAt: 'desc' }],
  used: [
    { usedAt: { sort: 'desc', nulls: 'last' } },
    { verifyAt: { sort: 'desc', nulls: 'last' } },
    { createdAt: 'desc' },
  ],
  refunded: [
    { refundAt: { sort: 'desc', nulls: 'last' } },
    { createdAt: 'desc' },
  ],
  expired: [
    { expiresAt: { sort: 'desc', nulls: 'last' } },
    { createdAt: 'desc' },
  ],
};

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
