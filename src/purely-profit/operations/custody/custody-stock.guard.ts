// 冻结口径建单前置校验：从写服务中拆出，让写服务保持聚焦在事务与状态流转。
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { resolveCustodyAvailableStock } from '../../../shared/custody/custody-frozen-stock';
import { CUSTODY_PRODUCT_NOT_FOUND_MESSAGE } from './custody.constants';

/** 冻结校验所需的最小客户端：事务客户端与非事务客户端均满足 */
export type CustodyStockGuardClient = Pick<
  Prisma.TransactionClient,
  'custodyOrder' | 'product' | '$queryRaw'
>;

/** 参与冻结校验的最小入参：建单入参与已落库的存单都能满足 */
export interface CustodyFrozenStockScope {
  storeId: number;
  productId: number | null;
  stockMode: string;
  totalQty: number;
}

/**
 * 锁住商品行，串行化同一商品的冻结校验。
 *
 * 数据库隔离级别是 Read Committed：并发建单（或会员并发确认）会各自读到同一份
 * 「可用库存」并双双通过校验，最终冻结量超过物理库存。此处对商品行加排他锁，
 * 让同一商品的冻结校验排队执行。锁只在事务内有效，非事务调用会自动提交释放。
 */
async function lockProductRow(
  client: CustodyStockGuardClient,
  productId: number,
): Promise<void> {
  await client.$queryRaw`
    SELECT id FROM products WHERE id = ${productId} FOR UPDATE
  `;
}

/**
 * 冻结口径校验：寄存量不得超过可用库存。
 *
 * 可用库存 = 物理库存 − 在存冻结量；sold 口径不占库存，跳过校验。
 * 这里只读不写：冻结只是"占用可用额度"，物理库存保持不变，由库存侧按聚合口径扣减。
 *
 * 调用方必须把它与随后的落库/状态流转放进同一事务，否则锁随自动提交释放，
 * 并发下仍会超额冻结。
 */
export async function ensureCustodyFrozenStockAvailable(
  client: CustodyStockGuardClient,
  input: CustodyFrozenStockScope,
): Promise<void> {
  if (input.stockMode !== 'frozen' || input.productId === null) {
    return;
  }
  const productId = input.productId;

  await lockProductRow(client, productId);

  const product = await client.product.findFirst({
    where: { id: productId, storeId: input.storeId, deletedAt: null },
    select: { name: true, stock: true },
  });
  if (!product) {
    throw new NotFoundException(CUSTODY_PRODUCT_NOT_FOUND_MESSAGE);
  }

  const available = await resolveCustodyAvailableStock(
    client,
    input.storeId,
    productId,
    product.stock,
  );
  if (available < input.totalQty) {
    throw new BadRequestException(
      `商品【${product.name}】可用库存不足，当前可用 ${available}，无法按冻结库存口径寄存 ${input.totalQty}`,
    );
  }
}
