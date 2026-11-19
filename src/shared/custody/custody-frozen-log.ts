// 客存冻结台账：frozen 口径下「可用库存」的每一次增减都必须留痕。
//
// 物理库存本身不变（冻结只是占用可用额度），所以这里记录的是
// 「可用库存 = 物理库存 − 在存冻结量」的 before / after，
// 门店在盘点时要能回答「为什么这件商品突然不能卖 / 又能卖了」。
//
// before / after 不能由调用方按「当前这一单」算：同一商品可能同时存在多张
// 冻结存单，逐单相减会得到「物理库存 → 物理库存 − 本单」的假曲线。
// 因此统一在事务内按聚合冻结量回算，保证台账与真实可用量一致。
//
// 三个调整类型的分工：
// - custody_freeze  存入占用（可用库存下降）
// - custody_pickup  取出解冻（可用库存回升）
// - custody_release 作废解冻（可用库存回升）
import type { Prisma } from '@prisma/client';
import { sumCustodyFrozenQty } from './custody-frozen-stock';

/** 写台账所需的最小客户端：事务客户端与非事务客户端均满足 */
export type CustodyFrozenLogClient = Pick<
  Prisma.TransactionClient,
  'product' | 'custodyOrder' | 'inventoryAdjustmentLog'
>;

export interface CustodyFrozenLogParams {
  storeId: number;
  productId: number;
  productName: string;
  /** 本次冻结量的变化绝对量 */
  qty: number;
  operatorStaffId: number | null;
  orderNo: string;
  note: string;
  /**
   * 已读到的物理库存。冻结校验与台账在同一事务内顺序发生，
   * 传值即可让台账省掉对同一商品行的一次重读；不传则自行回源。
   */
  physicalStock?: number | null;
}

async function writeFrozenLedgerLog(
  client: CustodyFrozenLogClient,
  params: CustodyFrozenLogParams,
  adjustType: 'custody_freeze' | 'custody_pickup' | 'custody_release',
): Promise<void> {
  // 带门店条件查询：避免跨店商品 ID 撞号时把台账记到别家门店
  // 若调用方已在同事务内读过该商品行（冻结校验），直接复用，不再重读
  let physicalStock = params.physicalStock;
  if (physicalStock === null || physicalStock === undefined) {
    const product = await client.product.findFirst({
      where: { id: params.productId, storeId: params.storeId, deletedAt: null },
      select: { stock: true },
    });
    if (!product) {
      return;
    }
    physicalStock = product.stock;
  }

  /*
   * 台账写入时机固定在状态 / 余量变更之后：
   * - 冻结：存单已转为 stored，聚合已含本单；
   * - 解冻：存单余量已扣减或已作废，聚合已不含本单。
   * 因此此时聚合出的就是变更后的真实可用量，before 按方向反推即可。
   */
  const frozenQtyByProduct = await sumCustodyFrozenQty(client, params.storeId, [
    params.productId,
  ]);
  const availableAfter = Math.max(
    0,
    physicalStock - (frozenQtyByProduct.get(params.productId) ?? 0),
  );
  const availableBefore =
    adjustType === 'custody_freeze'
      ? availableAfter + params.qty
      : Math.max(0, availableAfter - params.qty);

  await client.inventoryAdjustmentLog.create({
    data: {
      storeId: params.storeId,
      productId: params.productId,
      operatorStaffId: params.operatorStaffId,
      productName: params.productName,
      beforeStock: availableBefore,
      afterStock: availableAfter,
      delta: adjustType === 'custody_freeze' ? -params.qty : params.qty,
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
  return writeFrozenLedgerLog(client, params, 'custody_freeze');
}

/** 取出解冻：可用库存增加 qty（存单被取出，释放占用） */
export function writeCustodyPickupReleaseLog(
  client: CustodyFrozenLogClient,
  params: CustodyFrozenLogParams,
): Promise<void> {
  return writeFrozenLedgerLog(client, params, 'custody_pickup');
}

/** 作废解冻：可用库存增加 qty（冻结口径存单被作废，释放全部剩余占用） */
export function writeCustodyVoidReleaseLog(
  client: CustodyFrozenLogClient,
  params: CustodyFrozenLogParams,
): Promise<void> {
  return writeFrozenLedgerLog(client, params, 'custody_release');
}
