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
    const [additionalRevenue, spaceRevenue] = await Promise.all([
      this.loadAdditionalRevenue(additionalOrderWhere),
      this.loadSpaceRevenue(storeId, shiftRange),
    ]);

    // 与 buildRecordRevenueDetail / 实时交班页口径一致：
    // 本班营业额 = 非空间销售营收 + 空间会话消费（timeCost + itemsCost）。
    // 退款（来自空间会话预付溢出）在详情/页面中作为独立字段展示，不在此处扣除。
    const additionalRevenueAmount = Money.fromInputYuan(
      dbCentsToOutputYuan(additionalRevenue._sum.totalRevenue ?? 0),
    );
    const spaceRevenueAmount = Money.fromInputYuan(
      dbCentsToOutputYuan(
        new Prisma.Decimal(spaceRevenue._sum.timeCost ?? 0).plus(
          spaceRevenue._sum.itemsCost ?? 0,
        ),
      ),
    );

    return additionalRevenueAmount.add(spaceRevenueAmount).toOutputYuan();
  }

  async buildRecordRevenueDetail(
    storeId: number,
    shiftRange: ShiftDateRange,
    _operatorStaffId: number | null,
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

    const [
      paymentOrderItems,
      orderItems,
      orderCount,
      spaceRevenue,
      additionalRevenue,
      pettyCash,
      settledSpaceSessions,
    ] = await Promise.all([
      this.prisma.saleOrderItem.findMany({
        where: {
          storeId,
          order: { ...orderWhere, refund: { is: null } },
        },
        select: SALE_ORDER_ITEM_SELECT,
      }),
      this.prisma.saleOrderItem.findMany({
        where: {
          storeId,
          order: { ...orderWhere, refund: { is: null } },
        },
        select: SALE_ORDER_ITEM_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ORDER_ITEMS_LIMIT,
      }),
      this.prisma.saleOrder.count({
        where: { ...orderWhere, refund: { is: null } },
      }),
      this.loadSpaceRevenue(storeId, shiftRange),
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

    // 退款金额直接从 SpaceSession 数据计算：预付 > 消费时的差额
    const saleRefund = this.prisma.saleOrderRefund
      ? await this.prisma.saleOrderRefund.aggregate({
          where: {
            storeId,
            refundedAt: {
              gte: shiftRange.startAt,
              lte: shiftRange.endAt,
            },
          },
          _sum: { amount: true },
        })
      : { _sum: { amount: 0 } };
    const refundAmount = Money.fromDbCents(Number(saleRefund?._sum.amount ?? 0))
      .add(
        Money.fromInputYuan(
          computeRefundAmountFromSessions(settledSpaceSessions),
        ),
      )
      .toOutputYuan();

    const paymentItems = mapPaymentItems(paymentOrderItems);
    const totalReceivedAmount = sumPaymentAmounts(paymentItems);
    const revenueAmounts = buildRevenueAmounts(
      new Prisma.Decimal(spaceRevenue._sum.timeCost ?? 0).plus(
        spaceRevenue._sum.itemsCost ?? 0,
      ),
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
