// 自助下单订单行 → 响应结构映射
//
// 单独成文件的原因：响应字段是前端契约，任何字段调整都只应改动这一处；
// 让它和「幂等 + 事务 + 定价」混在一个 service 里时，契约改动会淹没在业务代码中。
import type { Prisma } from '@prisma/client';

/** 映射所需的订单行结构（查询 include items 后的最小字段集） */
export interface SelfOrderResponseRow {
  id: number;
  orderNo: string;
  storeId: number;
  sessionId: number;
  spaceId: number;
  remark: string | null;
  itemTotalAmount: number;
  payableAmount: number;
  status: string;
  paymentStatus: string;
  version: number;
  createdAt: Date;
  items: Array<{
    id: number;
    productId: string;
    productName: string;
    categoryName: string | null;
    salePrice: number;
    quantity: number;
    specSignature?: string | null;
  }>;
}

/** 订单行 → 对外响应（金额单位为分，时间统一 ISO 字符串） */
export function toSelfOrderResponse(
  order: SelfOrderResponseRow,
): Record<string, unknown> {
  return {
    id: order.id,
    orderNo: order.orderNo,
    storeId: order.storeId,
    sessionId: order.sessionId,
    spaceId: order.spaceId,
    remark: order.remark,
    itemTotalAmount: order.itemTotalAmount,
    payableAmount: order.payableAmount,
    status: order.status,
    paymentStatus: order.paymentStatus,
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      categoryName: item.categoryName,
      salePrice: item.salePrice,
      quantity: item.quantity,
      specSignature: item.specSignature ?? null,
    })),
  };
}

/** 幂等记录中回放所需的字段（快照是落库时的响应体） */
export interface SelfOrderIdempotencyRecord {
  status: string;
  responseSnapshot: Prisma.JsonValue | null;
}
