import { Injectable } from '@nestjs/common';
import {
  FinanceCashFlowCategory,
  FinanceCashFlowDirection,
  FinanceCashFlowPayment,
  SpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  HandoverPageQueryDto,
  HandoverPageResponseDto,
} from './dto/handover-page.dto';
import { HandoverPageShiftService } from './handover-page-shift.service';
import {
  SALE_ORDER_ITEM_SELECT,
  attachPaymentRatios,
  buildCashFlowWhere,
  buildSaleOrderWhere,
  mapPaymentItems,
  mergeDisplayedOrderItems,
  sumPaymentAmounts,
} from './handover-page.shared';
import {
  ORDER_ITEMS_LIMIT,
  buildShiftDateRange,
  extendShiftRangeToReference,
  roundMoney,
  toMoneyNumber,
  type OrderItemRow,
  type RefundOrderRow,
  type ResolvedHandoverPageShiftContext,
} from './handover.shared';

type HandoverPageMetrics = {
  orderCount: number;
  paymentOrderItems: OrderItemRow[];
  orderItems: OrderItemRow[];
  refundOrders: RefundOrderRow[];
  additionalRevenueAmount: number;
  spaceRevenueAmount: number;
  refundAmount: number;
  pettyCashAmount: number;
};

@Injectable()
export class HandoverPageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly handoverPageShiftService: HandoverPageShiftService,
  ) {}

  async getHandoverPage(
    user: AuthenticatedUser,
    query: HandoverPageQueryDto,
  ): Promise<HandoverPageResponseDto> {
    const shiftContext =
      await this.handoverPageShiftService.resolvePageShiftContext(user, query);
    const shiftRange = this.buildPageShiftRange(shiftContext);
    const metrics = await this.loadPageMetrics(
      shiftContext,
      shiftRange.startAt,
      shiftRange.endAt,
    );

    return this.buildPageResponse(shiftContext, metrics);
  }

  private buildPageShiftRange(
    shiftContext: ResolvedHandoverPageShiftContext,
  ): { startAt: Date; endAt: Date } {
    const shiftRange = extendShiftRangeToReference(
      buildShiftDateRange(
        shiftContext.shiftInfo.startTime,
        shiftContext.shiftInfo.endTime,
        shiftContext.shiftRecord?.date,
      ),
      new Date(),
    );
    const receiverShiftStartTime = shiftContext.receiverCandidate?.shiftStartTime;
    const receiverShiftEndTime = shiftContext.receiverCandidate?.shiftEndTime;
    if (!receiverShiftStartTime || !receiverShiftEndTime) {
      return shiftRange;
    }

    const receiverShiftStartAt = buildShiftDateRange(
      receiverShiftStartTime,
      receiverShiftEndTime,
      shiftContext.receiverCandidate?.shiftDate ?? shiftContext.shiftRecord?.date,
    ).startAt;
    if (
      receiverShiftStartAt.getTime() <= shiftRange.startAt.getTime() ||
      receiverShiftStartAt.getTime() >= shiftRange.endAt.getTime()
    ) {
      return shiftRange;
    }

    return {
      startAt: shiftRange.startAt,
      endAt: receiverShiftStartAt,
    };
  }

  private async loadPageMetrics(
    shiftContext: ResolvedHandoverPageShiftContext,
    startAt: Date,
    endAt: Date,
  ): Promise<HandoverPageMetrics> {
    const { membership, displayOperatorStaffId } = shiftContext;
    const shiftRange = { startAt, endAt };
    const orderWhere = buildSaleOrderWhere(
      membership.storeId,
      shiftRange,
      displayOperatorStaffId,
    );
    const cashFlowWhere = buildCashFlowWhere(
      membership.storeId,
      shiftRange,
      displayOperatorStaffId,
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
      this.loadPaymentOrderItems(membership.storeId, orderWhere),
      this.loadRecentOrderItems(membership.storeId, orderWhere),
      this.loadRefundOrders(orderWhere),
      this.prisma.saleOrder.count({ where: orderWhere }),
      this.loadSpaceRevenue(membership.storeId, startAt, endAt),
      this.loadAdditionalRevenue(orderWhere),
      this.loadRefundRevenue(orderWhere),
      this.loadPettyCash(cashFlowWhere),
    ]);

    return {
      orderCount,
      paymentOrderItems,
      orderItems,
      refundOrders,
      additionalRevenueAmount: toMoneyNumber(
        additionalRevenue._sum.totalRevenue,
      ),
      spaceRevenueAmount: toMoneyNumber(spaceRevenue._sum.timeCost),
      refundAmount: Math.abs(toMoneyNumber(refundRevenue._sum.totalRevenue)),
      pettyCashAmount: toMoneyNumber(pettyCash._sum.amount),
    };
  }

  private async loadPaymentOrderItems(
    storeId: number,
    orderWhere: ReturnType<typeof buildSaleOrderWhere>,
  ): Promise<OrderItemRow[]> {
    return this.prisma.saleOrderItem.findMany({
      where: {
        storeId,
        order: orderWhere,
      },
      select: SALE_ORDER_ITEM_SELECT,
    });
  }

  private async loadRecentOrderItems(
    storeId: number,
    orderWhere: ReturnType<typeof buildSaleOrderWhere>,
  ): Promise<OrderItemRow[]> {
    return this.prisma.saleOrderItem.findMany({
      where: {
        storeId,
        order: orderWhere,
      },
      select: SALE_ORDER_ITEM_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ORDER_ITEMS_LIMIT,
    });
  }

  private async loadRefundOrders(
    orderWhere: ReturnType<typeof buildSaleOrderWhere>,
  ): Promise<RefundOrderRow[]> {
    return this.prisma.saleOrder.findMany({
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
    });
  }

  private async loadSpaceRevenue(storeId: number, startAt: Date, endAt: Date) {
    return this.prisma.spaceSession.aggregate({
      where: {
        storeId,
        status: SpaceSessionStatus.settled,
        endTime: {
          gte: startAt,
          lte: endAt,
        },
      },
      _sum: { timeCost: true },
    });
  }

  private async loadAdditionalRevenue(
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

  private async loadRefundRevenue(
    orderWhere: ReturnType<typeof buildSaleOrderWhere>,
  ) {
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

  private async loadPettyCash(
    cashFlowWhere: ReturnType<typeof buildCashFlowWhere>,
  ) {
    return this.prisma.financeCashFlowRecord.aggregate({
      where: {
        ...cashFlowWhere,
        direction: FinanceCashFlowDirection.income,
        category: FinanceCashFlowCategory.transfer_in,
        payment: FinanceCashFlowPayment.cash,
      },
      _sum: { amount: true },
    });
  }

  private buildPageResponse(
    shiftContext: ResolvedHandoverPageShiftContext,
    metrics: HandoverPageMetrics,
  ): HandoverPageResponseDto {
    const paymentItems = mapPaymentItems(metrics.paymentOrderItems);
    const totalReceivedAmount = sumPaymentAmounts(paymentItems);
    const totalRevenue = roundMoney(
      metrics.additionalRevenueAmount +
        metrics.spaceRevenueAmount -
        metrics.refundAmount,
    );

    return {
      selectedShiftType: shiftContext.shiftInfo.shiftType,
      shiftInfo: shiftContext.shiftInfo,
      revenueSummary: {
        additionalRevenue: metrics.additionalRevenueAmount,
        spaceRevenue: metrics.spaceRevenueAmount,
        totalRevenue,
        orderCount: metrics.orderCount,
        pettyCache: metrics.pettyCashAmount,
        refundAmount: metrics.refundAmount,
      },
      paymentItems: attachPaymentRatios(paymentItems, totalReceivedAmount),
      orderItems: mergeDisplayedOrderItems(
        metrics.orderItems,
        metrics.refundOrders,
      ),
      receiverName: shiftContext.receiverCandidate?.employeeName ?? '',
      canOperate: shiftContext.operationAccess.canOperate,
      operationBlockedReason: shiftContext.operationAccess.blockedReason,
    };
  }
}
