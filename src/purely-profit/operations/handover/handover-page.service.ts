import { Injectable } from '@nestjs/common';
import {
  FinanceCashFlowCategory,
  FinanceCashFlowDirection,
  FinanceCashFlowPayment,
  HandoverStatus,
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
  buildNonSpaceSessionOrderWhere,
  buildSaleOrderItemOrderWhere,
  buildSaleOrderWhere,
  buildSpaceRefundOrderWhere,
  mapPaymentItems,
  mergeDisplayedOrderItems,
  sumPaymentAmounts,
} from './handover-page.shared';
import {
  ORDER_ITEMS_LIMIT,
  addMoney,
  buildShiftDateRange,
  extendShiftRangeToReference,
  toMoneyNumber,
  type OrderItemRow,
  type RefundOrderRow,
  type ResolvedHandoverPageShiftContext,
} from './handover.shared';
import type { Prisma, SalesPaymentMethod } from '@prisma/client';

type SettledSpaceSessionRow = {
  id: number;
  timeCost: Prisma.Decimal | null;
  itemsCost: Prisma.Decimal;
  prepaidAmount: Prisma.Decimal | null;
  endTime: Date | null;
  space: { name: string };
  saleOrder: {
    paymentMethod: SalesPaymentMethod;
    date: Date;
  } | null;
};

type HandoverPageMetrics = {
  orderCount: number;
  paymentOrderItems: OrderItemRow[];
  orderItems: OrderItemRow[];
  refundOrders: RefundOrderRow[];
  additionalRevenueAmount: number;
  spaceRevenueAmount: number;
  refundAmount: number;
  pettyCashAmount: number;
  settledSpaceSessions: SettledSpaceSessionRow[];
};

const EMPTY_METRICS: HandoverPageMetrics = {
  orderCount: 0,
  paymentOrderItems: [],
  orderItems: [],
  refundOrders: [],
  additionalRevenueAmount: 0,
  spaceRevenueAmount: 0,
  refundAmount: 0,
  pettyCashAmount: 0,
  settledSpaceSessions: [],
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

    // 交班完成且无后续排班时，所有数据已通过交班确认归档，
    // 不再加载任何指标，交班页面显示空态。
    // 主账号在此之后通过 additional / space-management 发生的
    // 记账和结账不应出现在交班页面中。
    if (shiftContext.handoverCompletedAndNoUpcomingShift) {
      return this.buildPageResponse(shiftContext, EMPTY_METRICS);
    }

    const shiftRange = await this.resolvePageShiftRange(
      shiftContext,
      new Date(),
    );
    const metrics = await this.loadPageMetrics(
      shiftContext,
      shiftRange.startAt,
      shiftRange.endAt,
    );

    return this.buildPageResponse(shiftContext, metrics);
  }

  private async resolvePageShiftRange(
    shiftContext: ResolvedHandoverPageShiftContext,
    referenceAt: Date,
  ): Promise<{ startAt: Date; endAt: Date }> {
    const shiftRange = extendShiftRangeToReference(
      buildShiftDateRange(
        shiftContext.shiftInfo.startTime,
        shiftContext.shiftInfo.endTime,
        shiftContext.shiftRecord?.date,
      ),
      referenceAt,
    );
    const initializedStartAt = await this.findShiftInitializedStartAt(
      shiftContext,
      shiftRange.startAt,
      referenceAt,
    );

    return initializedStartAt
      ? {
          startAt: initializedStartAt,
          endAt: shiftRange.endAt,
        }
      : shiftRange;
  }

  private async findShiftInitializedStartAt(
    shiftContext: ResolvedHandoverPageShiftContext,
    shiftStartAt: Date,
    referenceAt: Date,
  ): Promise<Date | null> {
    // 查找同门店内，在本班次开始时间之后、完成的最新交班记录
    // 该交班时刻即为本班次的统计起点（过滤上一班未交班时段的数据）
    // 注：不按 employeeShiftIdSnapshot 过滤，因为老板主账号交班时不写 snapshot
    const previousHandover = await this.prisma.storeHandoverRecord.findFirst({
      where: {
        storeId: shiftContext.membership.storeId,
        status: HandoverStatus.completed,
        handoverAt: {
          gt: shiftStartAt,
          lte: referenceAt,
        },
      },
      select: {
        handoverAt: true,
      },
      orderBy: [{ handoverAt: 'desc' }, { id: 'desc' }],
    });

    return previousHandover?.handoverAt ?? null;
  }

  private async loadPageMetrics(
    shiftContext: ResolvedHandoverPageShiftContext,
    startAt: Date,
    endAt: Date,
  ): Promise<HandoverPageMetrics> {
    const { membership } = shiftContext;
    const shiftRange = { startAt, endAt };
    const orderWhere = buildSaleOrderWhere(membership.storeId, shiftRange);
    const additionalOrderWhere = buildNonSpaceSessionOrderWhere(
      membership.storeId,
      shiftRange,
    );
    const cashFlowWhere = buildCashFlowWhere(membership.storeId, shiftRange);
    const refundWhere = buildSpaceRefundOrderWhere(
      membership.storeId,
      shiftRange,
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
      settledSpaceSessions,
    ] = await Promise.all([
      this.loadPaymentOrderItems(membership.storeId, shiftRange),
      this.loadRecentOrderItems(membership.storeId, shiftRange),
      this.loadRefundOrders(refundWhere),
      this.prisma.saleOrder.count({ where: orderWhere }),
      this.loadSpaceRevenue(membership.storeId, startAt, endAt),
      this.loadAdditionalRevenue(additionalOrderWhere),
      this.loadRefundRevenue(refundWhere),
      this.loadPettyCash(cashFlowWhere),
      this.loadSettledSpaceSessions(membership.storeId, startAt, endAt),
    ]);

    return {
      orderCount,
      paymentOrderItems,
      orderItems,
      refundOrders,
      additionalRevenueAmount: toMoneyNumber(
        additionalRevenue._sum.totalRevenue,
      ),
      spaceRevenueAmount: addMoney(
        toMoneyNumber(spaceRevenue._sum.timeCost),
        toMoneyNumber(spaceRevenue._sum.itemsCost),
      ),
      refundAmount: Math.abs(toMoneyNumber(refundRevenue._sum.totalRevenue)),
      pettyCashAmount: toMoneyNumber(pettyCash._sum.amount),
      settledSpaceSessions,
    };
  }

  private async loadPaymentOrderItems(
    storeId: number,
    shiftRange: { startAt: Date; endAt: Date },
  ): Promise<OrderItemRow[]> {
    return this.prisma.saleOrderItem.findMany({
      where: {
        storeId,
        order: buildSaleOrderItemOrderWhere(storeId, shiftRange),
      },
      select: SALE_ORDER_ITEM_SELECT,
    });
  }

  private async loadRecentOrderItems(
    storeId: number,
    shiftRange: { startAt: Date; endAt: Date },
  ): Promise<OrderItemRow[]> {
    return this.prisma.saleOrderItem.findMany({
      where: {
        storeId,
        order: buildSaleOrderItemOrderWhere(storeId, shiftRange),
      },
      select: SALE_ORDER_ITEM_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ORDER_ITEMS_LIMIT,
    });
  }

  private async loadRefundOrders(
    refundWhere: ReturnType<typeof buildSpaceRefundOrderWhere>,
  ): Promise<RefundOrderRow[]> {
    return this.prisma.saleOrder.findMany({
      where: refundWhere,
      select: {
        id: true,
        date: true,
        paymentMethod: true,
        totalRevenue: true,
        operatorNameSnapshot: true,
        operatorStaff: {
          select: {
            name: true,
            role: true,
            employeeProfile: {
              select: {
                subAccounts: {
                  select: { role: true },
                  take: 1,
                },
              },
            },
          },
        },
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
      _sum: { timeCost: true, itemsCost: true },
    });
  }

  private async loadSettledSpaceSessions(
    storeId: number,
    startAt: Date,
    endAt: Date,
  ): Promise<SettledSpaceSessionRow[]> {
    return this.prisma.spaceSession.findMany({
      where: {
        storeId,
        status: SpaceSessionStatus.settled,
        endTime: {
          gte: startAt,
          lte: endAt,
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

  private async loadAdditionalRevenue(
    orderWhere: ReturnType<typeof buildNonSpaceSessionOrderWhere>,
  ) {
    return this.prisma.saleOrder.aggregate({
      where: orderWhere,
      _sum: { totalRevenue: true },
    });
  }

  private async loadRefundRevenue(
    refundWhere: ReturnType<typeof buildSpaceRefundOrderWhere>,
  ) {
    return this.prisma.saleOrder.aggregate({
      where: refundWhere,
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
    // 营业收入 = additionalRevenue（仅非空间订单，不含负数）
    // 空间管理 = spaceRevenue（空间会话消费金额 = itemsCost + timeCost）
    // 本班营业额 = 营业收入 + 空间管理
    const totalRevenue = addMoney(
      metrics.additionalRevenueAmount,
      metrics.spaceRevenueAmount,
    );

    // 当所有班次已交接完成且无后续排班时，
    // 清空操作员名字并移除头像，前端回退到用户注册时的默认头像。
    let { shiftInfo } = shiftContext;
    if (shiftContext.handoverCompletedAndNoUpcomingShift) {
      shiftInfo = {
        ...shiftInfo,
        operatorAvatar: undefined,
        avatar: undefined,
        operatorName: '',
      };
    }

    return {
      selectedShiftType: shiftContext.shiftInfo.shiftType,
      shiftInfo,
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
        metrics.settledSpaceSessions,
      ),
      receiverName: shiftContext.receiverCandidate?.employeeName ?? '',
      canOperate: shiftContext.operationAccess.canOperate,
      operationBlockedReason: shiftContext.operationAccess.blockedReason,
      handoverCompletedAndNoUpcomingShift:
        shiftContext.handoverCompletedAndNoUpcomingShift,
    };
  }
}
