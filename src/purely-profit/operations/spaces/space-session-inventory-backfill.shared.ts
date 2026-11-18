// 结账回填：把空间追加点单产生的库存扣减流水挂到本次结账的销售单上。
//
// 口径约定：
// - 加单时销售单尚未创建，扣库存流水只能先落 relatedSpaceSessionId；
// - 结账按 relatedSpaceSessionId 等值定位，不再依赖 note 文案拼接（改文案会静默漏回填）；
// - saleOrderId IS NULL 是幂等前置条件：重复结账 / 重试不会覆盖已回填的单号。
import type { Prisma } from '@prisma/client';

export interface BackfillSpaceAddItemInventoryParams {
  storeId: number;
  sessionId: number;
  saleOrderId: number;
}

/**
 * 回填本次结账会话的追加点单库存扣减流水。
 *
 * 命中 `idx_inventory_adjustment_logs_pending_space_session`
 * （partial：`sale_order_id IS NULL`），扫描范围 = 该会话待回填的流水条数，
 * 与全店库存流水规模无关。
 *
 * @returns 实际回填的流水条数（0 表示本会话没有待回填流水）
 */
export async function backfillSpaceAddItemInventoryLogs(
  tx: Prisma.TransactionClient,
  params: BackfillSpaceAddItemInventoryParams,
): Promise<number> {
  const result = await tx.inventoryAdjustmentLog.updateMany({
    where: {
      storeId: params.storeId,
      adjustType: 'sale',
      saleOrderId: null,
      relatedSpaceSessionId: params.sessionId,
    },
    data: { saleOrderId: params.saleOrderId },
  });

  return result.count;
}
