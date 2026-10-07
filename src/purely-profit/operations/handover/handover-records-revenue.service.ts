import { Injectable } from '@nestjs/common';
import {
  FinanceCashFlowCategory,
  FinanceCashFlowDirection,
  FinanceCashFlowPayment,
  Prisma,
  SpaceSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import type { HandoverRecordListItemDto } from './dto/handover-records.dto';
import {
  ORDER_ITEMS_LIMIT,
  dbCentsToOutputYuan,
  type ShiftDateRange,
} from './handover.shared';
import {
  SALE_ORDER_ITEM_SELECT,
  buildCashFlowWhere,
  buildNonSpaceSessionOrderWhere,
  buildSaleOrderWhere,
} from './handover-page-query.builders';
import { mergeDisplayedOrderItems } from './handover-page-order-items';
import {
  attachPaymentRatios,
  computeRefundAmountFromSessions,
  buildRecordRevenueSummary,
  buildRevenueAmounts,
  mapPaymentItems,
  sumPaymentAmounts,
} from './handover-page-payment';

@Injectable()
export class HandoverRecordsRevenueService {
  constructor(private readonly prisma: PrismaService) {}

  async countRecordRevenue(
    storeId: number,
    shiftRange: ShiftDateRange,
    _operatorStaffId: number | null,
  ): Promise<number> {
    const additionalOrderWhere = buildNonSpaceSessionOrderWhere(
      storeId,
      shiftRange,
    );
    const [additionalRevenue, spaceRevenue, scanOrderingRevenue] =
      await Promise.all([
        this.loadAdditionalRevenue(additionalOrderWhere),
        this.loadSpaceRevenue(storeId, shiftRange),
        this.loadScanOrderingRevenue(storeId, shiftRange),
      ]);

    // 与 buildRecordRevenueDetail / 实时交班页口径一致：
    // 本班营业额 = 非空间销售营收 + 空间会话消费（timeCost + itemsCost） + 扫码点餐订单收入。
    // 退款（来自空间会话预付溢出）在详情/页面中作为独立字段展示，不在此处扣除。
    const additionalRevenueAmount = Money.fromInputYuan(
      dbCentsToOutputYuan(additionalRevenue._sum.totalRevenue ?? 0),
    );
    const spaceRevenueAmount = Money.fromInputYuan(
      dbCentsToOutputYuan(
        new Prisma.Decimal(spaceRevenue._sum.timeCost ?? 0)
          .plus(spaceRevenue._sum.itemsCost ?? 0)
          .plus(scanOrderingRevenue._sum.totalRevenue ?? 0),
      ),
    );

    return additionalRevenueAmount.add(spaceRevenueAmount).toOutputYuan();
  }

  /**
   * 批量版本：用 3 次 raw SQL（UNNEST + LATERAL）替代 N×3 次 Prisma aggregate，
   * DB 往返从 3N 降为 3。口径与 countRecordRevenue 完全一致：
   * totalRevenue = additionalRevenue + spaceRevenue(timeCost + itemsCost) + scanOrderingRevenue
   * 退款不在此处扣减。
   */
  async countRecordRevenueBatch(
    storeId: number,
    shiftRanges: ShiftDateRange[],
  ): Promise<number[]> {
    if (shiftRanges.length === 0) {
      return [];
    }

    const startAtArray = shiftRanges.map((r) => r.startAt);
    const endAtArray = shiftRanges.map((r) => r.endAt);

    // 3 次并行 raw SQL，每次返回 N 行聚合结果（按 idx 对齐）
    const [additionalRows, spaceRows, scanOrderingRows] = await Promise.all([
      // additionalRevenue: 非空间销售 + 非扫码点餐订单的 total_revenue 之和
      this.prisma.$queryRaw<
        Array<{ idx: number; total: bigint | null }>
      >`
        WITH ranges AS (
          SELECT idx, start_at, end_at
          FROM UNNEST(
            ${startAtArray}::timestamptz[],
            ${endAtArray}::timestamptz[]
          ) WITH ORDINALITY AS t(start_at, end_at, idx)
        )
        SELECT r.idx,
          COALESCE(SUM(so.total_revenue), 0)::bigint AS total
        FROM ranges r
        LEFT JOIN LATERAL (
          SELECT total_revenue
          FROM sale_orders
          WHERE store_id = ${storeId}
            AND date >= r.start_at
            AND date <= r.end_at
            AND scan_order_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM space_sessions ss WHERE ss.sale_order_id = sale_orders.id
            )
        ) so ON true
        GROUP BY r.idx
        ORDER BY r.idx
      `,
      // spaceRevenue: 空间会话 time_cost + items_cost 之和
      this.prisma.$queryRaw<
        Array<{ idx: number; total: bigint | null }>
      >`
        WITH ranges AS (
          SELECT idx, start_at, end_at
          FROM UNNEST(
            ${startAtArray}::timestamptz[],
            ${endAtArray}::timestamptz[]
          ) WITH ORDINALITY AS t(start_at, end_at, idx)
        )
        SELECT r.idx,
          COALESCE(SUM(ss.time_cost), 0) + COALESCE(SUM(ss.items_cost), 0)::bigint AS total
        FROM ranges r
        LEFT JOIN LATERAL (
          SELECT time_cost, items_cost
          FROM space_sessions
          WHERE store_id = ${storeId}
            AND status = ${SpaceSessionStatus.settled}::text
            AND end_time IS NOT NULL
            AND end_time >= r.start_at
            AND end_time <= r.end_at
        ) ss ON true
        GROUP BY r.idx
        ORDER BY r.idx
      `,
      // scanOrderingRevenue: 扫码点餐订单（scan_order_id 非空）的 total_revenue 之和
      this.prisma.$queryRaw<
        Array<{ idx: number; total: bigint | null }>
      >`
        WITH ranges AS (
          SELECT idx, start_at, end_at
          FROM UNNEST(
            ${startAtArray}::timestamptz[],
            ${endAtArray}::timestamptz[]
          ) WITH ORDINALITY AS t(start_at, end_at, idx)
        )
        SELECT r.idx,
          COALESCE(SUM(so.total_revenue), 0)::bigint AS total
        FROM ranges r
        LEFT JOIN LATERAL (
          SELECT total_revenue
          FROM sale_orders
          WHERE store_id = ${storeId}
            AND date >= r.start_at
            AND date <= r.end_at
            AND scan_order_id IS NOT NULL
            AND total_revenue > 0
        ) so ON true
        GROUP BY r.idx
        ORDER BY r.idx
      `,
    ]);

    // 按 idx 对齐三组结果，与 countRecordRevenue 同口径计算
    return shiftRanges.map((_, i) => {
      const additionalCents = Number(additionalRows[i]?.total ?? 0);
      const spaceCents = Number(spaceRows[i]?.total ?? 0);
      const scanOrderingCents = Number(scanOrderingRows[i]?.total ?? 0);

      const additionalRevenueAmount = Money.fromInputYuan(
        dbCentsToOutputYuan(additionalCents),
      );
      const spaceRevenueAmount = Money.fromInputYuan(
        dbCentsToOutputYuan(spaceCents + scanOrderingCents),
      );

      return additionalRevenueAmount.add(spaceRevenueAmount).toOutputYuan();
    });
  }

  async buildRecordRevenueDetail(
    storeId: number,
    shiftRange: ShiftDateRange,
    _operatorStaffId: number | null,
    /** 当班操作员：扫码点餐订单（purelyClub 下单）无实际操作员时回退展示 */
    shiftOperatorName: string | null = null,
  ): Promise<
    Pick<
      HandoverRecordListItemDto,
      'revenueSummary' | 'paymentItems' | 'orderItems'
    >
  > {
    const orderWhere = buildSaleOrderWhere(storeId, shiftRange);
    const additionalOrderWhere = buildNonSpaceSessionOrderWhere(
      storeId,
      shiftRange,
    );
    const cashFlowWhere = buildCashFlowWhere(storeId, shiftRange);

    // 合并两次 findMany 为一次：原 paymentOrderItems（全量无 orderBy）和 orderItems（orderBy + take LIMIT）
    // where 和 select 完全相同，合并为一次带 orderBy 的全量查询后内存切片，DB 往返 2→1
    const [
      allOrderItems,
      orderCount,
      spaceRevenue,
      scanOrderingRevenue,
      additionalRevenue,
      pettyCash,
      settledSpaceSessions,
    ] = await Promise.all([
      this.prisma.saleOrderItem.findMany({
        where: {
          storeId,
          // 与实时交班页口径一致：不排除已退款订单，退款单的下单行与退款行同时展示
          order: orderWhere,
        },
        select: SALE_ORDER_ITEM_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.saleOrder.count({
        where: orderWhere,
      }),
      this.loadSpaceRevenue(storeId, shiftRange),
      this.loadScanOrderingRevenue(storeId, shiftRange),
      this.loadAdditionalRevenue(additionalOrderWhere),
      this.prisma.financeCashFlowRecord.aggregate({
        where: {
          ...cashFlowWhere,
          direction: FinanceCashFlowDirection.income,
          category: FinanceCashFlowCategory.transfer_in,
          payment: FinanceCashFlowPayment.cash,
        },
        _sum: { amount: true },
      }),
      this.loadSettledSpaceSessions(storeId, shiftRange),
    ]);

    // 退款金额：SpaceSession 预付溢出 + 扫码点餐退款明细（SaleOrderRefund）双重累加
    const saleOrderRefunds = await this.prisma.saleOrderRefund.findMany({
      where: {
        storeId,
        refundedAt: {
          gte: shiftRange.startAt,
          lte: shiftRange.endAt,
        },
      },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        refundedAt: true,
        saleOrder: {
          select: {
            id: true,
            date: true,
            manualEntry: true,
            // 手工补录单就餐方式：退款行商品名前缀区分堂食/外卖
            diningMode: true,
            sourceChannel: true,
            operatorNameSnapshot: true,
            operatorStaff: {
              select: {
                name: true,
                role: true,
                userId: true,
                employeeProfile: {
                  select: {
                    subAccounts: {
                      select: { role: true },
                    },
                  },
                },
              },
            },
            scanOrder: {
              select: {
                table: {
                  select: {
                    tableCode: true,
                  },
                },
              },
            },
            items: {
              select: {
                productName: true,
                // 退款行需要展示退款后恢复的库存：关联商品实时库存
                product: {
                  select: {
                    stock: true,
                    unit: true,
                  },
                },
              },
              orderBy: { id: 'asc' },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ refundedAt: 'desc' }, { id: 'desc' }],
    });
    const scanOrderingRefundCents = saleOrderRefunds.reduce(
      (sum, refund) => sum + Number(refund.amount ?? 0),
      0,
    );
    const refundAmount = Money.fromDbCents(scanOrderingRefundCents)
      .add(
        Money.fromInputYuan(
          computeRefundAmountFromSessions(settledSpaceSessions),
        ),
      )
      .toOutputYuan();

    // paymentOrderItems 用全量做支付方式聚合；orderItems 取前 ORDER_ITEMS_LIMIT 条做展示
    const paymentOrderItems = allOrderItems;
    const orderItems = allOrderItems.slice(0, ORDER_ITEMS_LIMIT);

    const paymentItems = mapPaymentItems(paymentOrderItems);
    const totalReceivedAmount = sumPaymentAmounts(paymentItems);
    const revenueAmounts = buildRevenueAmounts(
      new Prisma.Decimal(spaceRevenue._sum.timeCost ?? 0)
        .plus(spaceRevenue._sum.itemsCost ?? 0)
        .plus(scanOrderingRevenue._sum.totalRevenue ?? 0),
      additionalRevenue._sum.totalRevenue,
      refundAmount,
    );

    // 门店主账号 user.id：操作员职位判定依据（主账号=紫）
    const storeOwnerUserId = await this.loadStoreOwnerUserId(storeId);

    return {
      revenueSummary: buildRecordRevenueSummary(
        revenueAmounts,
        orderCount,
        dbCentsToOutputYuan(pettyCash._sum.amount),
      ),
      paymentItems: attachPaymentRatios(paymentItems, totalReceivedAmount),
      orderItems: mergeDisplayedOrderItems(
        orderItems,
        // 退款展示项统一由 buildRefundItemsFromSessions 从 SpaceSession 数据构建，
        // 不再使用 SaleOrder 维度的 refundOrders，防止同一会话退款重复展示。
        [],
        settledSpaceSessions,
        storeOwnerUserId,
        shiftOperatorName,
        // 扫码点餐退款行（SaleOrderRefund）：负数退款行与下单行并存，保证账目平衡
        saleOrderRefunds,
      ),
    };
  }

  /** 读取门店主账号 user.id（store.ownerId） */
  private async loadStoreOwnerUserId(storeId: number): Promise<number | null> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { ownerId: true },
    });
    return store?.ownerId ?? null;
  }

  private loadSpaceRevenue(storeId: number, shiftRange: ShiftDateRange) {
    return this.prisma.spaceSession.aggregate({
      where: {
        storeId,
        status: SpaceSessionStatus.settled,
        endTime: {
          gte: shiftRange.startAt,
          lte: shiftRange.endAt,
        },
      },
      _sum: { timeCost: true, itemsCost: true },
    });
  }

  /** 扫码点餐订单（purelyClub 下单）收入：餐饮账号下计入 spaceRevenue（扫码点餐指标） */
  private loadScanOrderingRevenue(storeId: number, shiftRange: ShiftDateRange) {
    return this.prisma.saleOrder.aggregate({
      where: {
        storeId,
        date: {
          gte: shiftRange.startAt,
          lte: shiftRange.endAt,
        },
        scanOrderId: { not: null },
        totalRevenue: { gt: 0 },
      },
      _sum: { totalRevenue: true },
    });
  }

  private loadSettledSpaceSessions(
    storeId: number,
    shiftRange: ShiftDateRange,
  ) {
    return this.prisma.spaceSession.findMany({
      where: {
        storeId,
        status: SpaceSessionStatus.settled,
        endTime: {
          gte: shiftRange.startAt,
          lte: shiftRange.endAt,
        },
      },
      select: {
        id: true,
        timeCost: true,
        itemsCost: true,
        prepaidAmount: true,
        prepaidGrouponCode: true,
        prepaidCustomerPaymentMethod: true,
        prepaidGrouponPlatform: true,
        endTime: true,
        space: {
          select: {
            name: true,
          },
        },
        saleOrder: {
          select: {
            paymentMethod: true,
            date: true,
            operatorNameSnapshot: true,
            operatorStaff: {
              select: {
                name: true,
                role: true,
                userId: true,
                employeeProfile: {
                  select: {
                    subAccounts: {
                      select: { role: true },
                    },
                  },
                },
              },
            },
          },
        },
        // ─── ⚠️ DO NOT REMOVE：退款/应付计算依赖续费记录 ────────
        // prepaidAmount 不含续费金额，必须独立查询 sessionRenewRecords
        sessionRenewRecords: {
          select: {
            amount: true,
            paymentMethod: true,
          },
          orderBy: { id: 'asc' },
        },
      },
    });
  }

  private loadAdditionalRevenue(
    orderWhere: ReturnType<typeof buildNonSpaceSessionOrderWhere>,
  ) {
    return this.prisma.saleOrder.aggregate({
      where: orderWhere,
      _sum: { totalRevenue: true },
    });
  }
}
