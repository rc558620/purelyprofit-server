// 客存冻结台账：frozen 口径下「可用库存」的每一次增减都必须留痕。
//
// 物理库存本身不变（冻结只是占用可用额度），所以这里记录的是
// 「可用库存 = 物理库存 − 在存冻结量」的 before / after，
// 门店在盘点时要能回答「为什么这件商品突然不能卖 / 又能卖了」。
//
// 三个调整类型的分工：
// - custody_freeze  存入占用（可用库存下降）
// - custody_pickup  取出解冻（可用库存回升）
// - custody_release 作废解冻（可用库存回升）
import type { Prisma } from '@prisma/client';

/** 写台账所需的最小客户端：事务客户端与非事务客户端均满足 */
export type CustodyFrozenLogClient = Pick<
  Prisma.TransactionClient,
  'product' | 'inventoryAdjustmentLog'
>;

export interface CustodyFrozenLogParams {
  storeId: number;
  productId: number;
  productName: string;
  /** 本次冻结量的变化绝对量 */
  qty: number;
  beforeRemainingQty: number;
  afterRemainingQty: number;
  operatorStaffId: number | null;
  orderNo: string;
  note: string;
}

async function writeFrozenLedgerLog(
  client: CustodyFrozenLogClient,
  params: CustodyFrozenLogParams,
  adjustType: 'custody_freeze' | 'custody_pickup' | 'custody_release',
  delta: number,
): Promise<void> {
  // 带门店条件查询：避免跨店商品 ID 撞号时把台账记到别家门店
  const product = await client.product.findFirst({
    where: { id: params.productId, storeId: params.storeId, deletedAt: null },
    select: { stock: true },
  });
  if (!product) {
    return;
  }

  await client.inventoryAdjustmentLog.create({
    data: {
      storeId: params.storeId,
      productId: params.productId,
      operatorStaffId: params.operatorStaffId,
      productName: params.productName,
      beforeStock: product.stock - params.beforeRemainingQty,
      afterStock: product.stock - params.afterRemainingQty,
      delta,
      adjustType,
      note: params.note,
    },
  });
}

/** 存入占用：可用库存减少 qty */
export function writeCustodyFreezeLog(
  client: CustodyFrozenLogClient,
  params: CustodyFrozenLogParams,
): Promise<void> {
  return writeFrozenLedgerLog(client, params, 'custody_freeze', -params.qty);
}

/** 取出解冻：可用库存增加 qty（存单被取出，释放占用） */
export function writeCustodyPickupReleaseLog(
  client: CustodyFrozenLogClient,
  params: CustodyFrozenLogParams,
): Promise<void> {
  return writeFrozenLedgerLog(client, params, 'custody_pickup', params.qty);
}

/** 作废解冻：可用库存增加 qty（冻结口径存单被作废，释放全部剩余占用） */
export function writeCustodyVoidReleaseLog(
  client: CustodyFrozenLogClient,
  params: CustodyFrozenLogParams,
): Promise<void> {
  return writeFrozenLedgerLog(client, params, 'custody_release', params.qty);
}
