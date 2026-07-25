import { Injectable } from '@nestjs/common';
import {
  EmployeeShiftType,
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
  buildCashFlowWhere,
  buildNonSpaceSessionOrderWhere,
  buildSaleOrderItemOrderWhere,
  buildSaleOrderWhere,
} from './handover-page-query.builders';
import {
  mergeDisplayedOrderItems,
  type SettledSpaceSessionRow,
} from './handover-page-order-items';
import {
  attachPaymentRatios,
  computeRefundAmountFromSessions,
  mapPaymentItems,
  sumPaymentAmounts,
} from './handover-page-payment';
import {
  ORDER_ITEMS_LIMIT,
  buildShiftDateRange,
  extendShiftRangeToReference,
  dbCentsToOutputYuan,
  type OrderItemRow,
  type ResolvedHandoverPageShiftContext,
  type HandoverPageMetrics,
  EMPTY_METRICS,
} from './handover.shared';
import { Money } from '../../../shared/money.utils';

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

  /**
   * 轻量权限解析：仅解析交班操作权限上下文，不做整页指标聚合。
   * 供写接口（确认/创建/完成/取消交班）的 pre-check 使用，
   * 避免为了读 canOperate 而跑一遍完整交班页渲染（BUG-5 性能优化）。
   */
  async resolveHandoverOperationAccess(
    user: AuthenticatedUser,
    shiftType?: HandoverPageQueryDto['shiftType'],
  ): Promise<{
    canOperate: boolean;
    blockedReason: string | null;
    selectedShiftType: EmployeeShiftType;
  }> {
    const shiftContext =
      await this.handoverPageShiftService.resolvePageShiftContext(
        user,
        shiftType ? { shiftType } : {},
      );

    return {
      canOperate: shiftContext.operationAccess.canOperate,
      blockedReason: shiftContext.operationAccess.blockedReason,
      selectedShiftType: shiftContext.shiftInfo.shiftType,
    };
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
    const [
      paymentOrderItems,
      orderItems,
      orderCount,
      spaceRevenue,
      additionalRevenue,
      pettyCash,
      settledSpaceSessions,
    ] = await Promise.all([
      this.loadPaymentOrderItems(membership.storeId, shiftRange),
      this.loadRecentOrderItems(membership.storeId, shiftRange),
      this.prisma.saleOrder.count({ where: orderWhere }),
      this.loadSpaceRevenue(membership.storeId, startAt, endAt),
      this.loadAdditionalRevenue(additionalOrderWhere),
      this.loadPettyCash(cashFlowWhere),
      this.loadSettledSpaceSessions(membership.storeId, startAt, endAt),
    ]);

    // 退款金额直接从 SpaceSession 数据计算：预付 > 消费时的差额
    const refundAmount = computeRefundAmountFromSessions(settledSpaceSessions);

    return {
      orderCount,
      paymentOrderItems,
      orderItems,
      additionalRevenueAmount: dbCentsToOutputYuan(
        additionalRevenue._sum.totalRevenue,
      ),
      spaceRevenueAmount: Money.fromDbCents(spaceRevenue._sum.timeCost ?? 0)
        .add(Money.fromDbCents(spaceRevenue._sum.itemsCost ?? 0))
        .toOutputYuan(),
      refundAmount,
      pettyCashAmount: dbCentsToOutputYuan(pettyCash._sum.amount),
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

  private async loadAdditionalRevenue(
    orderWhere: ReturnType<typeof buildNonSpaceSessionOrderWhere>,
  ) {
    return this.prisma.saleOrder.aggregate({
      where: orderWhere,
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
    const totalRevenue = Money.fromInputYuan(metrics.additionalRevenueAmount)
      .add(Money.fromInputYuan(metrics.spaceRevenueAmount))
      .toOutputYuan();

    // 当所有班次已交接完成且无后续排班时，
    // 移除头像，前端回退到默认头像。
    // operatorName 保持 buildPageShiftInfo 返回的默认值（'当前员工'），
    // 不覆盖为空字符串，否则前端会 fallback 到登录用户名。
    let { shiftInfo } = shiftContext;
    if (shiftContext.handoverCompletedAndNoUpcomingShift) {
      shiftInfo = {
        ...shiftInfo,
        operatorAvatar: undefined,
        avatar: undefined,
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
        // 退款展示项统一由 buildRefundItemsFromSessions 从 SpaceSession 数据构建，
        // 不再使用 SaleOrder 维度的 refundOrders，防止同一会话退款重复展示。
        [],
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
