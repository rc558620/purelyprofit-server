// 桌台手工补录单读取：一次性拉取各桌录入单并按桌台分组（新链路 scan_orders + 老数据 saleOrder 兜底）
import type { PrismaService } from '../../../prisma/prisma.service';

/** 手工补录单在桌台列表中的统一展示行 */
export interface ManualEntryOrderRow {
  id: number;
  orderNo: string;
  status: string;
  fulfillmentStatus: string;
  totalAmount: number;
  guestCount: number | null;
  createdAt: Date;
}

/**
 * 一次性拉取各桌手工补录单，按桌台分组返回；覆盖全部桌台（含无扫码会话的空桌，
 * 由调用方按各自轮次窗口归并），select 携带人数供录入轮次合计。
 * 同时查询 scan_orders（新链路）和 saleOrder（老数据兜底），统一返回结构。
 */
export const loadManualEntryOrdersByTable = async (
  prisma: PrismaService,
  storeId: number,
  tableIds: number[],
  earliestStart: Date,
): Promise<Map<number, ManualEntryOrderRow[]>> => {
  if (tableIds.length === 0) return new Map();
  const grouped = new Map<number, ManualEntryOrderRow[]>();

  // 新链路：scan_orders 手工单（走状态机，显示真实状态）。
  // 进行中录入单不限时间（跨天未处理的录入单须占用桌台）；
  // 已完结（completed）录入单仅取轮次窗口内，供桌台抽屉展示履约记录。
  // 老数据兜底走 saleOrder，两者互不依赖，并行发起省一次往返；
  // 结果处理仍保持原有顺序：老数据要按 orderNo 对新链路结果去重。
  const [newManualOrders, oldManualOrders] = await Promise.all([
    prisma.scanOrders.findMany({
      where: {
        storeId,
        manualEntry: true,
        tableId: { in: tableIds },
        OR: [
          { status: { in: ['pending_acceptance', 'preparing', 'served'] } },
          { status: 'completed', createdAt: { gte: earliestStart } },
        ],
      },
      select: {
        id: true,
        orderNo: true,
        status: true,
        fulfillmentStatus: true,
        payableAmount: true,
        guestCount: true,
        createdAt: true,
        tableId: true,
      },
    }),
    prisma.saleOrder.findMany({
      where: {
        storeId,
        manualEntry: true,
        diningTableId: { in: tableIds },
        createdAt: { gte: earliestStart },
      },
      select: {
        id: true,
        orderNo: true,
        totalRevenue: true,
        guestCount: true,
        createdAt: true,
        diningTableId: true,
      },
    }),
  ]);
  for (const order of newManualOrders) {
    if (order.tableId === null) continue;
    const list = grouped.get(order.tableId) ?? [];
    list.push({
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      totalAmount: order.payableAmount,
      guestCount: order.guestCount,
      createdAt: order.createdAt,
    });
    grouped.set(order.tableId, list);
  }

  // 老数据兜底：改造前已落 SaleOrder 的手工补录单（状态固定为 completed）
  for (const order of oldManualOrders) {
    if (order.diningTableId === null) continue;
    // 避免新老数据重复（以 orderNo 去重）
    const existingNos =
      grouped.get(order.diningTableId)?.map((o) => o.orderNo) ?? [];
    if (existingNos.includes(order.orderNo)) continue;
    const list = grouped.get(order.diningTableId) ?? [];
    list.push({
      id: order.id,
      orderNo: order.orderNo,
      status: 'completed',
      fulfillmentStatus: 'served',
      totalAmount: order.totalRevenue,
      guestCount: order.guestCount,
      createdAt: order.createdAt,
    });
    grouped.set(order.diningTableId, list);
  }

  return grouped;
};
