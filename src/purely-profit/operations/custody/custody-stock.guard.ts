// 冻结口径建单前置校验：从写服务中拆出，让写服务保持聚焦在事务与状态流转。
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { resolveCustodyAvailableStock } from '../../../shared/custody/custody-frozen-stock';
import { CUSTODY_PRODUCT_NOT_FOUND_MESSAGE } from './custody.constants';
import type { CustodyCreateInput } from './custody.types';

/**
 * 冻结口径建单前置校验：寄存量不得超过可用库存。
 *
 * 可用库存 = 物理库存 − 在存冻结量；sold 口径不占库存，跳过校验。
 * 这里只读不写：冻结只是"占用可用额度"，物理库存保持不变，由库存侧按聚合口径扣减。
 */
export async function ensureCustodyFrozenStockAvailable(
  prisma: PrismaService,
  input: CustodyCreateInput,
): Promise<void> {
  if (input.stockMode !== 'frozen' || input.productId === null) {
    return;
  }
  const product = await prisma.product.findFirst({
    where: { id: input.productId, storeId: input.storeId, deletedAt: null },
    select: { name: true, stock: true },
  });
  if (!product) {
    throw new NotFoundException(CUSTODY_PRODUCT_NOT_FOUND_MESSAGE);
  }

  const available = await resolveCustodyAvailableStock(
    prisma,
    input.storeId,
    input.productId,
    product.stock,
  );
  if (available < input.totalQty) {
    throw new BadRequestException(
      `商品【${product.name}】可用库存不足，当前可用 ${available}，无法按冻结库存口径寄存 ${input.totalQty}`,
    );
  }
}
