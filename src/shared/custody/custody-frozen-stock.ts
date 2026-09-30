// 客存冻结库存聚合：frozen 口径下「可用库存 = 物理库存 − 在存冻结量」的唯一计算口径
// 纯查询函数（只依赖 Prisma 客户端），供客存与库存两个模块共用，避免模块级循环依赖
import type { Prisma } from '@prisma/client';

/** 支持冻结聚合的最小 Prisma 客户端（事务客户端与非事务客户端均满足） */
export type CustodyFrozenStockClient = Pick<
  Prisma.TransactionClient,
  'custodyOrder'
>;

/**
 * 聚合门店下指定商品的在存冻结量（key = productId，value = 在存剩余量合计）。
 *
 * 口径要点：
 * - 只统计 `stock_mode = 'frozen'` 的存单：历史单按各自快照走，门店后续切换口径不影响已有单；
 * - 只统计 `status = 'stored'` 且未软删的存单：已取完 / 已作废 / 待确认单不占用可用库存；
 * - 未开启 frozen 的门店聚合结果恒为 0，对既有库存链路零影响，因此无需调用方做开关判断。
 */
export async function sumCustodyFrozenQty(
  client: CustodyFrozenStockClient,
  storeId: number,
  productIds: readonly number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const uniqueIds = Array.from(new Set(productIds)).filter(
    (id) => Number.isSafeInteger(id) && id > 0,
  );
  if (uniqueIds.length === 0) {
    return result;
  }

  const rows = await client.custodyOrder.groupBy({
    by: ['productId'],
    where: {
      storeId,
      productId: { in: uniqueIds },
      stockMode: 'frozen',
      status: 'stored',
      deletedAt: null,
    },
    _sum: { remainingQty: true },
  });

  for (const row of rows) {
    if (row.productId === null) {
      continue;
    }
    result.set(row.productId, row._sum.remainingQty ?? 0);
  }
  return result;
}

/**
 * 读取单个商品的可用库存（物理库存 − 在存冻结量，最小为 0）。
 *
 * 冻结量大于物理库存属于脏数据（如先寄存后报损），此处截断到 0 而不是返回负数，
 * 避免下游把负数当"还能卖"或把负库存写回商品表。
 */
export async function resolveCustodyAvailableStock(
  client: CustodyFrozenStockClient,
  storeId: number,
  productId: number,
  physicalStock: number,
): Promise<number> {
  const frozenMap = await sumCustodyFrozenQty(client, storeId, [productId]);
  return Math.max(0, physicalStock - (frozenMap.get(productId) ?? 0));
}
