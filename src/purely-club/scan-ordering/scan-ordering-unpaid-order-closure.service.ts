import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ScanOrderPaymentAttemptStatus,
  ScanOrderStatus,
} from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import {
  aggregateStockRelease,
  applyStockRelease,
  type StockReleaseItem,
} from './scan-ordering-stock-release.helper';

export interface CloseUnpaidScanOrderInput {
  orderId: number;
  expectedVersion?: number;
  operatorType: string;
  operatorId?: number;
  reason: string;
}

/** 批量关单的入参：每条都带读取时的 version 做乐观锁前置条件 */
export interface CloseUnpaidScanOrderBatchItem {
  orderId: number;
  expectedVersion: number;
}

/** 批量关单的公共操作人 / 原因（同一批来自同一个触发源） */
export interface CloseUnpaidScanOrderBatchMeta {
  operatorType: string;
  operatorId?: number;
  reason: string;
}

/** 批量关单的订单行（SQL 返回） */
interface ClosedOrderRow {
  id: number;
  store_id: number;
  session_id: number | null;
}

/** 批量关单的订单项行（SQL 返回） */
interface BatchOrderItemRow {
  itemId: number;
  orderId: number;
  storeId: number;
  menuProductId: number;
  quantity: number;
  productId: number | null;
}

/** 批量关单的规格快照行（SQL 返回） */
interface BatchOrderSpecRow {
  itemId: number;
  specOptionId: number;
}

export interface ClosedUnpaidScanOrder {
  orderId: number;
  storeId: number;
  sessionId: number | null;
  status: 'cancelled';
  paymentStatus: 'unpaid';
  fulfillmentStatus: 'closed';
}

@Injectable()
export class ScanOrderingUnpaidOrderClosureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  async close(
    input: CloseUnpaidScanOrderInput,
  ): Promise<ClosedUnpaidScanOrder | null> {
    // 与 closeBatch 同口径显式设超时：单笔关单同样是「订单状态 + 库存回补 +
    // 支付尝试 + 券 + 历史」的多表写，不能依赖 Prisma 的交互式事务默认值
    // （5s，批量时代容易在慢库上直接超时并留下半途回滚的重试风暴）。
    const closed = await this.prisma.$transaction(
      (tx) => this.closeInTransaction(tx, input),
      { timeout: TX_TIMEOUT_MEDIUM },
    );
    if (closed) {
      this.realtimeService.publishOrderStatusChanged(closed);
    }
    return closed;
  }

  /**
   * 批量关闭未支付订单：一次事务、常量级往返。
   *
   * 超时扫描一次最多 100 笔，逐笔 `close()` 意味着 100 个交互式事务、约 900 条
   * 语句、100 次连接的拿取/归还；改成集合操作后：
   *  - 订单状态：1 条 `UPDATE ... FROM (VALUES)` 带 version 前置条件，
   *    用 RETURNING 精确拿回「真正被本批关掉」的行（并发抢到的单自动落空）；
   *  - 库存回补：1 条明细 + 1 条规格快照查询，按门店聚合后仍走既有的
   *    `applyStockRelease`（两阶段：先释放预留，不足再恢复已扣库存）；
   *  - 支付尝试 / 券占用 / 状态历史：各 1 条 `updateMany` / `createMany`。
   *
   * 语义与逐笔 `close()` 完全一致：同样带 status + paymentStatus + version 三重
   * 条件，同样只对「真的被关掉」的订单回补库存。
   */
  async closeBatch(
    items: CloseUnpaidScanOrderBatchItem[],
    meta: CloseUnpaidScanOrderBatchMeta,
  ): Promise<ClosedUnpaidScanOrder[]> {
    if (items.length === 0) return [];

    const closed = await this.prisma.$transaction(
      async (tx) => this.closeBatchInTransaction(tx, items, meta),
      { timeout: TX_TIMEOUT_MEDIUM },
    );
    for (const order of closed) {
      this.realtimeService.publishOrderStatusChanged(order);
    }
    return closed;
  }

  private async closeBatchInTransaction(
    tx: Prisma.TransactionClient,
    items: CloseUnpaidScanOrderBatchItem[],
    meta: CloseUnpaidScanOrderBatchMeta,
  ): Promise<ClosedUnpaidScanOrder[]> {
    const valueRows = Prisma.join(
      items.map(
        (item) =>
          Prisma.sql`(${item.orderId}::int, ${item.expectedVersion}::int)`,
      ),
    );
    // version 前置条件保证与并发支付 / 商家手动接单互斥：
    // 被并发推进过的订单不会出现在 RETURNING 里，也就不会回补库存。
    const closedRows = await tx.$queryRaw<ClosedOrderRow[]>`
      UPDATE "scan_orders" AS o
      SET "status" = 'cancelled',
          "fulfillment_status" = 'closed',
          "cancelled_at" = NOW() AT TIME ZONE 'UTC',
          "cancel_reason" = ${meta.reason},
          "version" = o."version" + 1,
          "updated_at" = NOW() AT TIME ZONE 'UTC'
      FROM (VALUES ${valueRows}) AS v(id, expected_version)
      WHERE o."id" = v.id
        AND o."version" = v.expected_version
        AND o."status" = 'pending_payment'
        AND o."payment_status" = 'unpaid'
      RETURNING o."id", o."store_id", o."session_id"
    `;
    if (closedRows.length === 0) return [];

    const orderIds = closedRows.map((row) => row.id);
    const closed: ClosedUnpaidScanOrder[] = closedRows.map((row) => ({
      orderId: row.id,
      storeId: row.store_id,
      sessionId: row.session_id,
      status: ScanOrderStatus.cancelled,
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'closed',
    }));

    await this.releaseStockForClosedOrders(tx, orderIds);

    await tx.scanOrderPaymentAttempt.updateMany({
      where: {
        orderId: { in: orderIds },
        status: {
          in: [
            ScanOrderPaymentAttemptStatus.created,
            ScanOrderPaymentAttemptStatus.paying,
          ],
        },
      },
      data: { status: ScanOrderPaymentAttemptStatus.closed },
    });
    await tx.scanOrderCouponUsage.updateMany({
      where: { orderId: { in: orderIds }, status: 'locked' },
      data: { status: 'released', releasedAt: new Date() },
    });
    await tx.scanOrderStatusHistory.createMany({
      data: closed.map((order) => ({
        orderId: order.orderId,
        storeId: order.storeId,
        fromStatus: ScanOrderStatus.pending_payment,
        toStatus: ScanOrderStatus.cancelled,
        operatorType: meta.operatorType,
        operatorId: meta.operatorId,
        reason: meta.reason,
      })),
    });

    return closed;
  }

  /**
   * 批量回补库存：按门店聚合后复用 `applyStockRelease`。
   *
   * 规格必须挂回所属订单项（用 itemId 关联），否则同一订单里不同数量、不同规格
   * 的两个订单项会共用一个数量，回补值就会错。
   */
  private async releaseStockForClosedOrders(
    tx: Prisma.TransactionClient,
    orderIds: number[],
  ): Promise<void> {
    const itemRows = await tx.$queryRaw<BatchOrderItemRow[]>`
      SELECT soi."id" AS "itemId",
             soi."order_id" AS "orderId",
             soi."store_id" AS "storeId",
             soi."menu_product_id" AS "menuProductId",
             soi."quantity" AS "quantity",
             mp."product_id" AS "productId"
      FROM "scan_order_items" AS soi
      LEFT JOIN "scan_ordering_menu_products" AS mp
        ON mp."id" = soi."menu_product_id"
      WHERE soi."order_id" IN (${Prisma.join(orderIds)})
    `;
    if (itemRows.length === 0) return;

    const specRows = await tx.$queryRaw<BatchOrderSpecRow[]>`
      SELECT sos."order_item_id" AS "itemId",
             sos."spec_option_id" AS "specOptionId"
      FROM "scan_order_item_specs" AS sos
      JOIN "scan_order_items" AS soi ON soi."id" = sos."order_item_id"
      WHERE soi."order_id" IN (${Prisma.join(orderIds)})
    `;

    const specIdsByItem = new Map<number, number[]>();
    for (const row of specRows) {
      const list = specIdsByItem.get(row.itemId);
      if (list) list.push(row.specOptionId);
      else specIdsByItem.set(row.itemId, [row.specOptionId]);
    }

    const itemsByStore = new Map<number, StockReleaseItem[]>();
    for (const row of itemRows) {
      const list = itemsByStore.get(row.storeId) ?? [];
      list.push({
        menuProductId: row.menuProductId,
        quantity: row.quantity,
        productId: row.productId,
        specOptionIds: specIdsByItem.get(row.itemId) ?? [],
      });
      itemsByStore.set(row.storeId, list);
    }

    for (const [storeId, items] of itemsByStore) {
      await applyStockRelease(tx, storeId, aggregateStockRelease(items));
    }
  }

  async closeInTransaction(
    tx: Prisma.TransactionClient,
    input: CloseUnpaidScanOrderInput,
  ): Promise<ClosedUnpaidScanOrder | null> {
    const order = await tx.scanOrders.findUnique({
      where: { id: input.orderId },
      select: { id: true, storeId: true, sessionId: true, version: true },
    });
    if (!order) return null;

    const updated = await tx.scanOrders.updateMany({
      where: {
        id: order.id,
        version: input.expectedVersion ?? order.version,
        status: ScanOrderStatus.pending_payment,
        paymentStatus: 'unpaid',
      },
      data: {
        status: ScanOrderStatus.cancelled,
        fulfillmentStatus: 'closed',
        cancelledAt: new Date(),
        cancelReason: input.reason,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return null;

    await this.restoreReservedStockInTransaction(tx, order.id);
    await tx.scanOrderPaymentAttempt.updateMany({
      where: {
        orderId: order.id,
        status: {
          in: [
            ScanOrderPaymentAttemptStatus.created,
            ScanOrderPaymentAttemptStatus.paying,
          ],
        },
      },
      data: { status: ScanOrderPaymentAttemptStatus.closed },
    });
    await tx.scanOrderCouponUsage.updateMany({
      where: { orderId: order.id, status: 'locked' },
      data: { status: 'released', releasedAt: new Date() },
    });
    await tx.scanOrderStatusHistory.create({
      data: {
        orderId: order.id,
        storeId: order.storeId,
        fromStatus: ScanOrderStatus.pending_payment,
        toStatus: ScanOrderStatus.cancelled,
        operatorType: input.operatorType,
        operatorId: input.operatorId,
        reason: input.reason,
      },
    });
    return {
      orderId: order.id,
      storeId: order.storeId,
      sessionId: order.sessionId,
      status: ScanOrderStatus.cancelled,
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'closed',
    };
  }

  async restoreReservedStockInTransaction(
    tx: Prisma.TransactionClient,
    orderId: number,
  ): Promise<void> {
    const order = await tx.scanOrders.findUniqueOrThrow({
      where: { id: orderId },
      select: { storeId: true },
    });
    const items = await tx.scanOrderItem.findMany({
      where: { orderId },
      select: {
        menuProductId: true,
        quantity: true,
        menuProduct: { select: { productId: true } },
        specs: { select: { specOptionId: true } },
      },
    });
    const plan = aggregateStockRelease(
      items.map((item) => ({
        menuProductId: item.menuProductId,
        quantity: item.quantity,
        productId: item.menuProduct.productId,
        specOptionIds: item.specs.map((spec) => spec.specOptionId),
      })),
    );
    await applyStockRelease(tx, order.storeId, plan);
  }
}
