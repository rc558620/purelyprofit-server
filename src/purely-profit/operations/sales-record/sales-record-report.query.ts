// 销售报表专用查询：只取金额 / 明细聚合链路真正读取的字段。
//
// 背景：列表与 CSV 共用的 querySaleOrders 带 4 层嵌套 select
//（operatorStaff.employeeProfile.subAccounts、spaceSession.sessionRenewRecords）
// 与十余个报表完全不读的列。报表在缓存未命中时按整个周期全量取数，
// 这些关联会随订单数放大 join / 反序列化 / 网络传输成本。
//
// 边界：本文件只精简「读取字段」，不改 where、不改排序、不改金额口径、
// 不改返回结构；金额与明细仍由 sales-record.domain 及 *-aggregation 中
// 原有纯函数计算。SalesReportOrder 是 SaleOrderWithItems 的结构子集，
// 完整对象仍可传给这些函数，列表 / CSV 调用方无需改动。
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SalesPeriodRange } from './sales-record.utils';

/** 报表金额与按天商品聚合所需的最小订单字段集。 */
const SALES_REPORT_ORDER_SELECT = {
  id: true,
  date: true,
  scanOrderId: true,
  paymentMethod: true,
  customerPaymentMethod: true,
  voucherFaceAmount: true,
  refund: { select: { refundedAt: true } },
  items: {
    select: {
      id: true,
      productId: true,
      productName: true,
      categoryName: true,
      salePrice: true,
      profit: true,
      quantity: true,
    },
    orderBy: [{ id: 'asc' }],
  },
  spaceSession: {
    select: {
      hourlyRate: true,
      space: { select: { name: true } },
    },
  },
} satisfies Prisma.SaleOrderSelect;

export type SalesReportOrder = Prisma.SaleOrderGetPayload<{
  select: typeof SALES_REPORT_ORDER_SELECT;
}>;

/**
 * 按门店 + 营业日范围取报表聚合用订单。
 *
 * 刻意保持与 querySaleOrders 完全一致的 where 与 orderBy：报表虽不依赖
 * 行序（金额是整数分加法、明细最终还会重排），但本次变更只负责「少读字段」，
 * 任何范围 / 顺序差异都不在改动范围内。
 */
export async function queryReportOrders(
  prisma: PrismaService,
  params: {
    storeId: number;
    range: SalesPeriodRange;
  },
): Promise<SalesReportOrder[]> {
  return prisma.saleOrder.findMany({
    where: {
      storeId: params.storeId,
      date: {
        gte: new Date(params.range.start),
        lte: new Date(params.range.end),
      },
    },
    select: SALES_REPORT_ORDER_SELECT,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
}
