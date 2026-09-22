import { Injectable } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  HandoverPageQueryDto,
  HandoverPageResponseDto,
} from './dto/handover-page.dto';
import { HandoverPageShiftService } from './handover-page-shift.service';
import {
  loadPageMetrics,
  resolvePageShiftRange,
} from './handover-page-metrics';
import { mergeDisplayedOrderItems } from './handover-page-order-items';
import {
  attachPaymentRatios,
  mapPaymentItems,
  sumPaymentAmounts,
} from './handover-page-payment';
import {
  EMPTY_METRICS,
  type HandoverPageMetrics,
  type ResolvedHandoverPageShiftContext,
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

    const shiftRange = await resolvePageShiftRange(
      this.prisma,
      shiftContext,
      new Date(),
    );
    const metrics = await loadPageMetrics(
      this.prisma,
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
        // 本班营业额 = 营业收入 + 扫码点餐（退款不在此扣减，作为独立指标展示）
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
        metrics.storeOwnerUserId,
        // 当班操作员：扫码点餐订单无实际操作员时回退展示
        shiftContext.shiftInfo.operatorName,
        // 扫码点餐退款行（SaleOrderRefund）：负数退款行与下单行并存，保证账目平衡
        metrics.saleOrderRefundItems,
      ),
      receiverName: shiftContext.receiverCandidate?.employeeName ?? '',
      canOperate: shiftContext.operationAccess.canOperate,
      operationBlockedReason: shiftContext.operationAccess.blockedReason,
      handoverCompletedAndNoUpcomingShift:
        shiftContext.handoverCompletedAndNoUpcomingShift,
    };
  }
}
