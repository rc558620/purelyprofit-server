// CSV 导出专用查询：只读 CSV 行真正用到的字段（从 sales-record.query 拆出，
// 避免列表查询文件继续膨胀；两者 where / orderBy / 金额口径保持一致）。
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { SALES_RECORD_LIST_ORDER_BY } from './sales-record-list.cursor';
import { SALES_REPORT_ORDER_SELECT } from './sales-record-report.query';
import type { SalesPeriodRange } from './sales-record.utils';

/**
 * CSV 行真正读取的字段：报表字段集 + 展示列。
 *
 * 刻意不加载 `operatorStaff`（角色 / 子账号）与
 * `spaceSession.sessionRenewRecords`（收款来源拆分）：两者只服务列表详情与
 * 收款明细，CSV 一行都不用，却会随订单数放大 join、序列化与传输成本
 * （大门店导出是万级订单）。
 */
const SALES_CSV_ORDER_SELECT = {
  ...SALES_REPORT_ORDER_SELECT,
  orderNo: true,
  note: true,
  operatorNameSnapshot: true,
  grouponPlatform: true,
  voucherPlatform: true,
  voucherCode: true,
  // 自动结账兜底展示「空间自动结账」所需：只多读会话表一个布尔列，不新增 join
  spaceSession: {
    select: {
      ...SALES_REPORT_ORDER_SELECT.spaceSession.select,
      autoCheckout: true,
    },
  },
} satisfies Prisma.SaleOrderSelect;

/** CSV 导出使用的订单查询形态（报表字段集 + 展示列的结构超集） */
export type SalesCsvOrder = Prisma.SaleOrderGetPayload<{
  select: typeof SALES_CSV_ORDER_SELECT;
}>;

/**
 * 分批扫描导出用订单（keyset 分页）。
 *
 * `cursor` 是上一批最后一条的 `id`：Prisma 会按该行在
 * `(date desc, id desc)` 中的位置换算成完整的 keyset 条件，因此
 * 「id 更大但 date 被补录到更早」的订单仍会落在正确的那一页，不会漏读或重复。
 *
 * ⚠️ 游标行必须仍然存在：若两批之间该订单被删除，锚点解析不出来，
 * 本批会返回空结果。导出侧因此把它当作「到末尾」处理，宁可少导一页，
 * 也不要把半截文件当成完整文件（汇总行已写出，无法回退）。
 */
export async function querySaleOrdersForCsv(
  prisma: PrismaService,
  params: {
    storeId: number;
    range: SalesPeriodRange;
    take?: number;
    cursor?: { id: number };
  },
): Promise<SalesCsvOrder[]> {
  return prisma.saleOrder.findMany({
    where: {
      storeId: params.storeId,
      date: {
        gte: new Date(params.range.start),
        lte: new Date(params.range.end),
      },
    },
    select: SALES_CSV_ORDER_SELECT,
    orderBy: SALES_RECORD_LIST_ORDER_BY,
    ...(params.cursor ? { cursor: params.cursor, skip: 1 } : {}),
    take: params.take,
  });
}
