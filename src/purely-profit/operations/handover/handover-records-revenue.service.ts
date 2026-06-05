import { Injectable } from '@nestjs/common';
import {
  FinanceCashFlowCategory,
  FinanceCashFlowDirection,
  FinanceCashFlowPayment,
  SpaceSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { HandoverRecordListItemDto } from './dto/handover-records.dto';
import { ORDER_ITEMS_LIMIT, roundMoney, toMoneyNumber, type ShiftDateRange } from './handover.shared';
import {
  SALE_ORDER_ITEM_SELECT,
  attachPaymentRatios,
  buildCashFlowWhere,
  buildRecordRevenueSummary,
  buildRevenueAmounts,
  buildSaleOrderWhere,
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
    const orderWhere = buildSaleOrderWhere(storeId, shiftRange, operatorStaffId);
    const [spaceRevenue, additionalRevenue, refundRevenue] =
      await Promise.all([
        this.loadSpaceRevenue(storeId, shiftRange),
        this.loadAdditionalRevenue(orderWhere),
        this.loadRefundRevenue(orderWhere),
      ]);

    const revenueAmounts = buildRevenueAmounts(
      spaceRevenue._sum.timeCost,
      additionalRevenue._sum.totalRevenue,
      refundRevenue._sum.totalRevenue,
    );

    return roundMoney(
      revenueAmounts.additionalRevenueAmount +
        revenueAmounts.spaceRevenueAmount -
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
    const orderWhere = buildSaleOrderWhere(storeId, shiftRange, operatorStaffId);
    const cashFlowWhere = buildCashFlowWhere(
      storeId,
      shiftRange,
      operatorStaffId,
    );

    const [
      paymentOrderItems,
      orderItems,
      refundOrders,
      orderCount,
      spaceRevenue,
      additionalRevenue,
      refundRevenue,
      pettyCash,
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
        where: {
          ...orderWhere,
          totalRevenue: {
            lt: 0,
          },
          spaceSession: {
            isNot: null,
          },
        },
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
      this.loadAdditionalRevenue(orderWhere),
      this.loadRefundRevenue(orderWhere),
      this.prisma.financeCashFlowRecord.aggregate({
        where: {
          ...cashFlowWhere,
          direction: FinanceCashFlowDirection.income,
          category: FinanceCashFlowCategory.transfer_in,
          payment: FinanceCashFlowPayment.cash,
        },
        _sum: { amount: true },
      }),
    ]);

    const paymentItems = mapPaymentItems(paymentOrderItems);
    const totalReceivedAmount = sumPaymentAmounts(paymentItems);
    const revenueAmounts = buildRevenueAmounts(
      spaceRevenue._sum.timeCost,
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
      orderItems: mergeDisplayedOrderItems(orderItems, refundOrders),
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
      _sum: { timeCost: true },
    });
  }

  private loadAdditionalRevenue(
    orderWhere: ReturnType<typeof buildSaleOrderWhere>,
  ) {
    return this.prisma.saleOrder.aggregate({
      where: {
        ...orderWhere,
        spaceSession: {
          is: null,
        },
      },
      _sum: { totalRevenue: true },
    });
  }

  private loadRefundRevenue(orderWhere: ReturnType<typeof buildSaleOrderWhere>) {
    return this.prisma.saleOrder.aggregate({
      where: {
        ...orderWhere,
        totalRevenue: {
          lt: 0,
        },
        spaceSession: {
          isNot: null,
        },
      },
      _sum: { totalRevenue: true },
    });
  }
}
