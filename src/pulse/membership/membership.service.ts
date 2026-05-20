import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../member/platform-membership/platform-membership.service';
import type {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipPlanResponseDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from '../../member/platform-membership/dto/platform-membership-response.dto';
import type { PurchasePlatformMembershipOrderDto } from '../../member/platform-membership/dto/platform-membership-query.dto';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../member/platform-membership/dto/platform-membership-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  PulseMembershipOrderDetailResponseDto,
  PulseMembershipOrderPayStatusResponseDto,
  PulseMembershipOrderPreviewResponseDto,
} from './dto/pulse-membership.dto';
import { PulseMembershipOrderPreviewDto } from './dto/pulse-membership.dto';

// ─────────────────────────────────────────────────────────────
// Constants（与 PlatformMembershipService 保持一致）
// ─────────────────────────────────────────────────────────────

const POINTS_RATE = 100; // 100 积分 = 1 元
const POINTS_DEDUCT_LIMIT = 0.3; // 积分最多抵扣 30%
const BEAN_DEDUCT_RATE = 100; // 1 豆 = 1 元（单位分：100 分）
const BEAN_DEDUCT_LIMIT = 0.5; // 纯利豆最多抵扣 50%

const PURCHASE_BONUS_POINTS: Record<
  (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number],
  number
> = {
  monthly: 0,
  quarterly: 300,
  yearly: 1500,
};

const PLAN_NAMES: Record<
  (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number],
  string
> = {
  monthly: '月度会员',
  quarterly: '季度会员',
  yearly: '年度会员',
};

const PLAN_PRICES: Record<
  (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number],
  number
> = {
  monthly: 3800,
  quarterly: 9900,
  yearly: 36900,
};

// ─────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────

interface PaymentPreviewResult {
  beanDeductAmount: number;
  actualBeansUsed: number;
  priceAfterBeans: number;
  pointsDeductAmount: number;
  actualPointsUsed: number;
  finalAmount: number;
}

@Injectable()
export class PulseMembershipService {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly prisma: PrismaService,
  ) {}

  // ──────────────────────────────────────────────
  // 代理：直接转发至 PlatformMembershipService
  // ──────────────────────────────────────────────

  listPlans(): PlatformMembershipPlanResponseDto[] {
    return this.platformMembershipService.listPlans();
  }

  getCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipCenterResponseDto> {
    return this.platformMembershipService.getCenter(user);
  }

  getProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipProfileResponseDto> {
    return this.platformMembershipService.getProfile(user);
  }

  listOrders(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    return this.platformMembershipService.listOrders(user);
  }

  purchaseOrder(
    user: AuthenticatedUser,
    dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    return this.platformMembershipService.purchaseOrder(user, dto);
  }

  listPointsLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    return this.platformMembershipService.listPointsLogs(user);
  }

  listBeanLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    return this.platformMembershipService.listBeanLogs(user);
  }

  getPromoCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.platformMembershipService.getPromoCenter(user);
  }

  // ──────────────────────────────────────────────
  // 新增：试算
  // ──────────────────────────────────────────────

  async previewOrder(
    user: AuthenticatedUser,
    dto: PulseMembershipOrderPreviewDto,
  ): Promise<PulseMembershipOrderPreviewResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);

    const planId = dto.planId;
    const planPrice = PLAN_PRICES[planId];
    const planName = PLAN_NAMES[planId];
    const requestedPoints = dto.usePoints ?? 0;
    const requestedBeans = dto.useBeans ?? 0;

    const [profile, partner] = await Promise.all([
      this.prisma.storeMembershipProfile.findFirst({
        where: { storeId },
        select: { availablePoints: true },
      }),
      this.prisma.storePartner.findFirst({
        where: { storeId, status: 'approved' },
        select: { beanBalance: true },
      }),
    ]);

    const availablePoints = profile?.availablePoints ?? 0;
    const availableBeans = partner?.beanBalance ?? 0;

    const preview = this.calcPaymentPreview({
      planPrice,
      requestedPoints,
      availablePoints,
      requestedBeans,
      availableBeans,
    });

    const bonusPoints = PURCHASE_BONUS_POINTS[planId] ?? 0;

    return {
      planId,
      planName,
      originalPrice: planPrice,
      beanDeducted: preview.beanDeductAmount,
      beansUsed: preview.actualBeansUsed,
      priceAfterBeans: preview.priceAfterBeans,
      pointsDeducted: preview.pointsDeductAmount,
      pointsUsed: preview.actualPointsUsed,
      finalAmount: preview.finalAmount,
      bonusPoints,
      availablePoints,
      availableBeans,
    };
  }

  // ──────────────────────────────────────────────
  // 新增：订单详情
  // ──────────────────────────────────────────────

  async getOrder(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<PulseMembershipOrderDetailResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);

    const order = await this.prisma.storeMembershipOrder.findFirst({
      where: { id: orderId, storeId },
      select: {
        id: true,
        planId: true,
        planName: true,
        originalAmount: true,
        amount: true,
        pointsDeducted: true,
        pointsUsed: true,
        beanDeducted: true,
        beansUsed: true,
        status: true,
        paymentOrderId: true,
        createdAt: true,
        paidAt: true,
      },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    return {
      id: String(order.id),
      planId: order.planId as (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number],
      planName: order.planName,
      originalAmount: order.originalAmount,
      amount: order.amount,
      pointsDeducted: order.pointsDeducted,
      pointsUsed: order.pointsUsed,
      beanDeducted: order.beanDeducted,
      beansUsed: order.beansUsed,
      status: order.status as 'pending' | 'paid' | 'failed' | 'refunded',
      wxOrderId: order.paymentOrderId,
      createdAt: order.createdAt.getTime(),
      paidAt: order.paidAt ? order.paidAt.getTime() : null,
    };
  }

  // ──────────────────────────────────────────────
  // 新增：支付状态查询（轮询用）
  // ──────────────────────────────────────────────

  async getOrderPayStatus(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<PulseMembershipOrderPayStatusResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);

    const order = await this.prisma.storeMembershipOrder.findFirst({
      where: { id: orderId, storeId },
      select: {
        id: true,
        status: true,
        paidAt: true,
      },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const status = order.status as 'pending' | 'paid' | 'failed' | 'refunded';

    return {
      id: String(order.id),
      status,
      isPaid: status === 'paid',
      paidAt: order.paidAt ? order.paidAt.getTime() : null,
    };
  }

  // ──────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────

  private getCurrentStoreIdOrThrow(user: AuthenticatedUser): number {
    const storeId = user.currentMembership?.storeId;

    if (!storeId) {
      throw new NotFoundException('当前账号未绑定门店，暂无法使用会员中心');
    }

    return storeId;
  }

  private calcPaymentPreview(params: {
    planPrice: number;
    requestedPoints: number;
    availablePoints: number;
    requestedBeans: number;
    availableBeans: number;
  }): PaymentPreviewResult {
    const {
      planPrice,
      requestedPoints,
      availablePoints,
      requestedBeans,
      availableBeans,
    } = params;

    const planPriceDecimal = new Decimal(planPrice);
    const zero = new Decimal(0);

    // 纯利豆抵扣（最多 50%）
    const maxBeanDeductAmount = planPriceDecimal.mul(BEAN_DEDUCT_LIMIT).floor();
    const beanDeductAmount = Decimal.max(
      zero,
      Decimal.min(
        new Decimal(requestedBeans).mul(BEAN_DEDUCT_RATE),
        maxBeanDeductAmount,
        new Decimal(availableBeans).mul(BEAN_DEDUCT_RATE),
      ),
    );
    const actualBeansUsed = beanDeductAmount.div(BEAN_DEDUCT_RATE).floor();

    // 纯利豆抵扣后的价格
    const priceAfterBeans = Decimal.max(
      zero,
      planPriceDecimal.minus(beanDeductAmount),
    );

    // 积分抵扣（最多 30%）
    const maxPointsDeductAmount = priceAfterBeans
      .mul(POINTS_DEDUCT_LIMIT)
      .floor();
    const requestedPointsDeductAmount = new Decimal(requestedPoints)
      .div(POINTS_RATE)
      .floor()
      .mul(100);
    const availablePointsDeductAmount = new Decimal(availablePoints)
      .div(POINTS_RATE)
      .floor()
      .mul(100);
    const pointsDeductAmount = Decimal.max(
      zero,
      Decimal.min(
        requestedPointsDeductAmount,
        availablePointsDeductAmount,
        maxPointsDeductAmount,
      ),
    );
    const actualPointsUsed = pointsDeductAmount.div(100).mul(POINTS_RATE);

    // 最终应付金额
    const finalAmount = Decimal.max(
      zero,
      priceAfterBeans.minus(pointsDeductAmount),
    );

    return {
      beanDeductAmount: beanDeductAmount.toNumber(),
      actualBeansUsed: actualBeansUsed.toNumber(),
      priceAfterBeans: priceAfterBeans.toNumber(),
      pointsDeductAmount: pointsDeductAmount.toNumber(),
      actualPointsUsed: actualPointsUsed.toNumber(),
      finalAmount: finalAmount.toNumber(),
    };
  }
}
