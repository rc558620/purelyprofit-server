// 自助下单建单的写入结构组装：订单行 + 商品行 + 规格明细快照
//
// 从 ClubSelfOrderingOrderService 拆出的原因：这段是「定价结果 → 落库快照」的
// 纯数据映射（含规格签名与规格选项展开），与幂等抢占、事务边界、额度扣减无关；
// 混在事务代码里会让快照字段调整难以 review。
import type { Prisma } from '@prisma/client';
import type { SelfOrderCreation } from './club-self-ordering-order.types';

/**
 * 组装 `selfOrder.create` 的写入数据。
 *
 * 价格与商品名一律取定价服务的结果（服务端权威重算），不读取客户端入参；
 * 规格选项按 `priced.items[].specOptions` 展开为商品行规格快照。
 */
export function buildSelfOrderCreateData(
  actorId: number,
  creation: SelfOrderCreation,
): Prisma.SelfOrderUncheckedCreateInput {
  return {
    storeId: creation.target.storeId,
    orderNo: creation.orderNo,
    sessionId: creation.target.sessionId,
    spaceId: creation.target.spaceId,
    clubUserId: actorId,
    remark: creation.dto.remark?.trim() || null,
    idempotencyKey: creation.key,
    itemTotalAmount: creation.priced.itemTotalAmount,
    payableAmount: creation.priced.payableAmount,
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    items: {
      create: creation.priced.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName,
        salePrice: item.salePrice,
        costPrice: item.costPrice,
        quantity: item.quantity,
        specSignature: item.specSignature,
        ...(item.specOptions.length > 0
          ? {
              specs: {
                create: item.specOptions.map((spec) => ({
                  specOptionId: spec.id,
                  specOptionNameSnapshot: spec.name,
                  extraPriceSnapshot: spec.extraPrice,
                })),
              },
            }
          : {}),
      })),
    },
  };
}
