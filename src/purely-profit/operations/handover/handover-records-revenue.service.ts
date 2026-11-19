import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { HandoverOrderItemDto } from './dto/handover-shared.dto';
import type { HandoverRecordListItemDto } from './dto/handover-records.dto';
import { dbCentsToOutputYuan, type ShiftDateRange } from './handover.shared';
import { buildNonSpaceSessionOrderWhere } from './handover-page-query.builders';
import { mergeDisplayedOrderItems } from './handover-page-order-items';
import {
  buildSaleStockSnapshotIndex,
  loadSaleStockSnapshotIndex,
} from './handover-stock-snapshot';
import {
  attachPaymentRatios,
  buildRecordRevenueSummary,
  buildRevenueAmounts,
  computeRecordRefundAmount,
  mapPaymentItems,
  sumPaymentAmounts,
  sumShiftRevenueYuan,
} from './handover-page-payment';
import {
  DEFAULT_RECORD_ORDER_ITEMS_PAGING,
  loadAdditionalRevenueSum,
  loadRecordRevenueDetailSource,
  loadScanOrderingRevenueSum,
  loadSpaceRevenueSum,
  sumSettledSpaceRevenueDbCents,
  type RecordOrderItemsPaging,
  type RecordRevenueDetailSource,
  type SaleOrderItemDetailRow,
} from './handover-records-revenue.query';
import { countRecordRevenueBatchYuan } from './handover-records-revenue-batch';

@Injectable()
export class HandoverRecordsRevenueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 单个班次的本班营业额（元）。
   * 口径：非空间销售营收 + 空间会话消费（timeCost + itemsCost） + 扫码点餐订单收入。
   * 退款（来自空间会话预付溢出）在详情/页面中作为独立字段展示，不在此处扣除。
   */
  async countRecordRevenue(
    storeId: number,
    shiftRange: ShiftDateRange,
  ): Promise<number> {
    const additionalOrderWhere = buildNonSpaceSessionOrderWhere(
      storeId,
      shiftRange,
    );
    const [additionalRevenue, spaceRevenue, scanOrderingRevenue] =
      await Promise.all([
        loadAdditionalRevenueSum(this.prisma, additionalOrderWhere),
        loadSpaceRevenueSum(this.prisma, storeId, shiftRange),
        loadScanOrderingRevenueSum(this.prisma, storeId, shiftRange),
      ]);

    const spaceRevenueCents =
      Number(spaceRevenue._sum.timeCost ?? 0) +
      Number(spaceRevenue._sum.itemsCost ?? 0) +
      Number(scanOrderingRevenue._sum.totalRevenue ?? 0);

    return sumShiftRevenueYuan(
      Number(additionalRevenue._sum.totalRevenue ?? 0),
      spaceRevenueCents,
    );
  }

  /**
   * 批量版本：用 3 次 raw SQL（UNNEST + LATERAL）替代 N×3 次 Prisma aggregate，
   * DB 往返从 3N 降为 3，口径与 countRecordRevenue 完全一致。
   */
  async countRecordRevenueBatch(
    storeId: number,
    shiftRanges: ShiftDateRange[],
  ): Promise<number[]> {
    return countRecordRevenueBatchYuan(this.prisma, storeId, shiftRanges);
  }

  async buildRecordRevenueDetail(
    storeId: number,
    shiftRange: ShiftDateRange,
    /** 当班操作员：扫码点餐订单（purelyClub 下单）无实际操作员时回退展示 */
    shiftOperatorName: string | null = null,
    /** 展示明细分页：支付聚合始终用全量，只有展示行按 limit/offset 切片 */
    paging: RecordOrderItemsPaging = DEFAULT_RECORD_ORDER_ITEMS_PAGING,
  ): Promise<
    Pick<
      HandoverRecordListItemDto,
      'revenueSummary' | 'paymentItems' | 'orderItems' | 'orderItemsTotal'
    >
  > {
    const source = await loadRecordRevenueDetailSource(
      this.prisma,
      storeId,
      shiftRange,
      paging,
    );

    // 支付方式聚合走全量的窄字段投影；展示行已在 DB 侧按分页切片
    const paymentItems = mapPaymentItems(source.paymentOrderItems);
    const totalReceivedAmount = sumPaymentAmounts(paymentItems);
    const revenueAmounts = buildRevenueAmounts(
      sumSettledSpaceRevenueDbCents(source.settledSpaceSessions) +
        Number(source.scanOrderingRevenue._sum.totalRevenue ?? 0),
      source.additionalRevenue._sum.totalRevenue,
      computeRecordRefundAmount(
        source.settledSpaceSessions,
        source.saleOrderRefunds,
      ),
    );

    return {
      revenueSummary: buildRecordRevenueSummary(
        revenueAmounts,
        source.orderCount,
        dbCentsToOutputYuan(source.pettyCash._sum.amount),
      ),
      paymentItems: attachPaymentRatios(paymentItems, totalReceivedAmount),
      orderItems: await this.buildDisplayedOrderItems(
        source,
        shiftOperatorName,
      ),
      orderItemsTotal: source.orderItemsTotal,
    };
  }

  /**
   * 交班明细展示行：商品行 + 空间会话退款/客人应付行 + 扫码点餐退款行，
   * 并按销售时点库存快照回填库存列。
   */
  private async buildDisplayedOrderItems(
    source: RecordRevenueDetailSource,
    shiftOperatorName: string | null,
  ): Promise<HandoverOrderItemDto[]> {
    // 展示行已在 DB 侧按分页取回（take/skip），这里不再内存 slice
    const orderItems: SaleOrderItemDetailRow[] = source.orderItems;
    // 门店主账号 user.id 已在数据源 Promise.all 中取回，避免详情路径多一次串行往返
    const storeOwnerUserId = source.storeOwnerUserId;

    // 销售时点库存快照：库存列显示该笔销售扣减完成后的库存；
    // 查不到流水的行按「当前库存 + 后续销量」倒推兜底（老订单/被退款流水）
    const preciseStockIndex = await loadSaleStockSnapshotIndex(
      this.prisma,
      orderItems,
    );
    const saleStockIndex = buildSaleStockSnapshotIndex(
      orderItems,
      preciseStockIndex,
    );

    return mergeDisplayedOrderItems(
      orderItems,
      // 退款展示项统一由 buildRefundItemsFromSessions 从 SpaceSession 数据构建，
      // 不再使用 SaleOrder 维度的 refundOrders，防止同一会话退款重复展示。
      [],
      source.settledSpaceSessions,
      storeOwnerUserId,
      shiftOperatorName,
      // 扫码点餐退款行（SaleOrderRefund）：负数退款行与下单行并存，保证账目平衡
      source.saleOrderRefunds,
      // 销售时点库存快照：库存列按该笔销售扣减完成后的库存展示
      saleStockIndex,
    );
  }
}
