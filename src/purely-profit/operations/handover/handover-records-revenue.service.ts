import { Injectable } from '@nestjs/common';
import {
  FinanceCashFlowCategory,
  FinanceCashFlowDirection,
  FinanceCashFlowPayment,
  SpaceSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { HandoverRecordListItemDto } from './dto/handover-records.dto';
import {
  ORDER_ITEMS_LIMIT,
  addMoney,
  subMoney,
  toMoneyNumber,
  type ShiftDateRange,
} from './handover.shared';
import {
  SALE_ORDER_ITEM_SELECT,
  attachPaymentRatios,
  buildCashFlowWhere,
  buildNonSpaceSessionOrderWhere,
  buildRecordRevenueSummary,
  buildRevenueAmounts,
  buildSaleOrderWhere,
  buildSpaceRefundOrderWhere,
  mapPaymentItems,
  mergeDisplayedOrderItems,
  sumPaymentAmounts,
} from './handover-page.shared';

@Injectable()
export class HandoverRecordsRevenueService {
  constructor(private readonly prisma: PrismaService) {}

  async countRecordRevenue(
    storeId: number,
    shiftRange: ShiftDateRange,
    operatorStaffId: number | null,
  ): Promise<number> {
    const additionalOrderWhere = buildNonSpaceSessionOrderWhere(
      storeId,
      shiftRange,
      operatorStaffId,
    );
    const refundWhere = buildSpaceRefundOrderWhere(storeId, shiftRange);
    const [spaceRevenue, additionalRevenue, refundRevenue] = await Promise.all([
      this.loadSpaceRevenue(storeId, shiftRange),
      this.loadAdditionalRevenue(additionalOrderWhere),
      this.loadRefundRevenue(refundWhere),
    ]);

    const revenueAmounts = buildRevenueAmounts(
      addMoney(
        toMoneyNumber(spaceRevenue._sum.timeCost),
        toMoneyNumber(spaceRevenue._sum.itemsCost),
      ),
      additionalRevenue._sum.totalRevenue,
      refundRevenue._sum.totalRevenue,
    );

    // additionalRevenue 已包含空间会话结账订单，不再叠加 spaceRevenue。
    return subMoney(
      revenueAmounts.additionalRevenueAmount,
      revenueAmounts.refundAmount,
    );
  }

  async buildRecordRevenueDetail(
    storeId: number,
    shiftRange: ShiftDateRange,
    operatorStaffId: number | null,
  ): Promise<
    Pick<
      HandoverRecordListItemDto,
      'revenueSummary' | 'paymentItems' | 'orderItems'
    >
  > {
    const orderWhere = buildSaleOrderWhere(
      storeId,
      shiftRange,
      operatorStaffId,
    );
    const additionalOrderWhere = buildNonSpaceSessionOrderWhere(
      storeId,
      shiftRange,
      operatorStaffId,
    );
    const cashFlowWhere = buildCashFlowWhere(
      storeId,
      shiftRange,
      operatorStaffId,
    );
    const refundWhere = buildSpaceRefundOrderWhere(storeId, shiftRange);

    const [
      paymentOrderItems,
      orderItems,
      refundOrders,
      orderCount,
      spaceRevenue,
      additionalRevenue,
      refundRevenue,
      pettyCash,
      settledSpaceSessions,
    ] = await Promise.all([
      this.prisma.saleOrderItem.findMany({
        where: {
          storeId,
          order: orderWhere,
        },
        select: SALE_ORDER_ITEM_SELECT,
      }),
      this.prisma.saleOrderItem.findMany({
        where: {
          storeId,
          order: orderWhere,
        },
        select: SALE_ORDER_ITEM_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ORDER_ITEMS_LIMIT,
      }),
      this.prisma.saleOrder.findMany({
        where: refundWhere,
        select: {
          id: true,
          date: true,
          paymentMethod: true,
          totalRevenue: true,
          spaceSession: {
            select: {
              space: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: ORDER_ITEMS_LIMIT,
      }),
      this.prisma.saleOrder.count({ where: orderWhere }),
      this.loadSpaceRevenue(storeId, shiftRange),
      this.loadAdditionalRevenue(additionalOrderWhere),
      this.loadRefundRevenue(refundWhere),
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

    const paymentItems = mapPaymentItems(paymentOrderItems);
    const totalReceivedAmount = sumPaymentAmounts(paymentItems);
    const revenueAmounts = buildRevenueAmounts(
      addMoney(
        toMoneyNumber(spaceRevenue._sum.timeCost),
        toMoneyNumber(spaceRevenue._sum.itemsCost),
      ),
      additionalRevenue._sum.totalRevenue,
      refundRevenue._sum.totalRevenue,
    );

    return {
      revenueSummary: buildRecordRevenueSummary(
        revenueAmounts,
        orderCount,
        toMoneyNumber(pettyCash._sum.amount),
      ),
      paymentItems: attachPaymentRatios(paymentItems, totalReceivedAmount),
      orderItems: mergeDisplayedOrderItems(
        orderItems,
        refundOrders,
        settledSpaceSessions,
      ),
    };
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
          },
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

  private loadRefundRevenue(
    refundWhere: ReturnType<typeof buildSpaceRefundOrderWhere>,
  ) {
    return this.prisma.saleOrder.aggregate({
      where: refundWhere,
      _sum: { totalRevenue: true },
    });
  }
}
