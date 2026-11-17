import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ShiftDateRange } from './handover.shared';
import {
  SALE_ORDER_ITEM_SELECT,
  buildNonSpaceSessionOrderWhere,
  buildSaleOrderWhere,
} from './handover-page-query.builders';
import {
  loadAdditionalRevenueSum,
  loadPettyCashSum,
  loadSaleOrderRefundRows,
  loadScanOrderingRevenueSum,
  loadSettledSpaceSessions,
  loadSpaceRevenueSum,
  loadStoreOwnerUserId,
  sumSettledSpaceRevenueDbCents,
  type CashFlowAmountSum,
  type SaleOrderRefundDetailRow,
  type SaleOrderRevenueSum,
  type SettledSpaceSessionDetailRow,
  type SpaceSessionRevenueSum,
} from './handover-revenue.loaders';

/**
 * 交班记录营收：本文件只做**编排**（哪几个查询、怎么并行），
 * 单个查询的实现与返回类型全部收敛在 handover-revenue.loaders.ts，
 * 与实时交班页共用同一份 loader，口径不可能分叉。
 */

/**
 * 聚合 loader 与聚合结果类型在此转出，
 * 让既有调用方（handover-records-revenue.service.ts 等）无需改 import 路径。
 */
export {
  loadAdditionalRevenueSum,
  loadScanOrderingRevenueSum,
  loadSpaceRevenueSum,
  sumSettledSpaceRevenueDbCents,
  type CashFlowAmountSum,
  type SaleOrderRevenueSum,
  type SpaceSessionRevenueSum,
  type SettledSpaceSessionDetailRow,
  type SaleOrderRefundDetailRow,
};

/** 交班明细订单行（SALE_ORDER_ITEM_SELECT） */
export type SaleOrderItemDetailRow = Prisma.SaleOrderItemGetPayload<{
  select: typeof SALE_ORDER_ITEM_SELECT;
}>;

/** 交班记录营收详情的数据源：一次取齐，service 只做口径拼装 */
export type RecordRevenueDetailSource = {
  /** 班次内全部订单明细（支付方式汇总用全量，展示用前 N 条） */
  orderItems: SaleOrderItemDetailRow[];
  orderCount: number;
  scanOrderingRevenue: SaleOrderRevenueSum;
  additionalRevenue: SaleOrderRevenueSum;
  pettyCash: CashFlowAmountSum;
  settledSpaceSessions: SettledSpaceSessionDetailRow[];
  /** 扫码点餐退款明细（SaleOrderRefund） */
  saleOrderRefunds: SaleOrderRefundDetailRow[];
  /** 门店主账号 user.id（store.ownerId）：操作员职位判定依据（主账号 = 紫） */
  storeOwnerUserId: number | null;
};

/** 班次内全部订单明细：合并原「支付聚合全量」与「展示前 N 条」两次查询 */
export const loadShiftOrderItems = (
  prisma: PrismaService,
  storeId: number,
  orderWhere: Prisma.SaleOrderWhereInput,
): Promise<SaleOrderItemDetailRow[]> =>
  prisma.saleOrderItem.findMany({
    where: {
      storeId,
      // 与实时交班页口径一致：不排除已退款订单，退款单的下单行与退款行同时展示
      order: orderWhere,
    },
    select: SALE_ORDER_ITEM_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

/**
 * 取齐交班记录营收详情所需数据。
 * 全部 8 个查询互不依赖（退款明细、门店主账号与其余聚合之间也没有先后关系），
 * 统一走一次 Promise.all：DB 往返从「4 段串行」压缩为「1 段并行」。
 *
 * ⚠️ 空间管理营收【不再】单独跑 spaceSession.aggregate：
 * loadSettledSpaceSessions 的 where 与之完全一致，行数据即唯一事实来源，
 * 由 sumSettledSpaceRevenueDbCents 内存累加（与实时交班页同一函数）。
 * 详情路径此前漏了这一点，等于同一个集合上跑两遍（聚合 + 取行）。
 */
export const loadRecordRevenueDetailSource = async (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftDateRange,
): Promise<RecordRevenueDetailSource> => {
  const orderWhere = buildSaleOrderWhere(storeId, shiftRange);
  const additionalOrderWhere = buildNonSpaceSessionOrderWhere(
    storeId,
    shiftRange,
  );

  const [
    orderItems,
    orderCount,
    scanOrderingRevenue,
    additionalRevenue,
    pettyCash,
    settledSpaceSessions,
    saleOrderRefunds,
    storeOwnerUserId,
  ] = await Promise.all([
    loadShiftOrderItems(prisma, storeId, orderWhere),
    prisma.saleOrder.count({ where: orderWhere }),
    loadScanOrderingRevenueSum(prisma, storeId, shiftRange),
    loadAdditionalRevenueSum(prisma, additionalOrderWhere),
    loadPettyCashSum(prisma, storeId, shiftRange),
    loadSettledSpaceSessions(prisma, storeId, shiftRange),
    loadSaleOrderRefundRows(prisma, storeId, shiftRange),
    loadStoreOwnerUserId(prisma, storeId),
  ]);

  return {
    orderItems,
    orderCount,
    scanOrderingRevenue,
    additionalRevenue,
    pettyCash,
    settledSpaceSessions,
    saleOrderRefunds,
    storeOwnerUserId,
  };
};
