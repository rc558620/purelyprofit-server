import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type {
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import type { PurchasePlatformMembershipOrderDto } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PulseMembershipOrderPreviewDto } from './dto/pulse-membership-orders.request.dto';
import type {
  PulseMembershipOrderDetailResponseDto,
  PulseMembershipOrderPayStatusResponseDto,
  PulseMembershipOrderPreviewResponseDto,
} from './dto/pulse-membership-orders.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import {
  BEAN_DEDUCT_LIMIT,
  BEAN_DEDUCT_RATE,
  POINTS_DEDUCT_LIMIT,
  POINTS_RATE,
  PURCHASE_BONUS_POINTS,
} from './membership.constants';
import type { PaymentPreviewResult } from './membership.types';

@Injectable()
export class PulseMembershipOrdersService {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

  async getCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipCenterResponseDto> {
    const store = await this.accessService.resolveTargetStoreForMembership(
      user,
      {
        notFoundMessage: '当前未选中目标商家门店，暂无法查看订阅中心',
      },
    );
    return this.platformMembershipService.getCenterByStoreId(store.id);
  }

  async getProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipProfileResponseDto> {
    const store = await this.accessService.resolveTargetStoreForMembership(
      user,
      {
        notFoundMessage: '当前未选中目标商家门店，暂无法查看订阅档案',
      },
    );
    return this.platformMembershipService.getProfileByStoreId(store.id);
  }

  async listOrders(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    const store = await this.accessService.resolveTargetStoreForMembership(
      user,
      {
        notFoundMessage: '当前未选中目标商家门店，暂无法查看订阅订单',
      },
    );
    return this.platformMembershipService.listOrdersByStoreId(store.id);
  }

  async purchaseOrder(
    user: AuthenticatedUser,
    _dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    void _dto; // 显式忽略，保留参数签名以便未来扩展
    await this.accessService.resolveTargetStoreForMembership(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法发起订阅操作',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家创建订阅订单',
    );
  }

  async getPromoCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    const store = await this.accessService.resolveTargetStoreForMembership(
      user,
      {
        notFoundMessage: '当前未选中目标商家门店，暂无法查看推广中心',
      },
    );
    return this.platformMembershipService.getPromoCenterByStoreId(store.id);
  }

  async previewOrder(
    user: AuthenticatedUser,
    dto: PulseMembershipOrderPreviewDto,
  ): Promise<PulseMembershipOrderPreviewResponseDto> {
    const store = await this.accessService.resolveTargetStoreForMembership(
      user,
      {
        notFoundMessage: '当前未选中目标门店，暂无法试算会员订单',
      },
    );

    const planId = dto.planId;
    const plan = await this.platformMembershipService.getPlanConfig(planId);
    const requestedPoints = dto.usePoints ?? 0;
    const requestedBeans = dto.useBeans ?? 0;

    const [profile, partner] = await Promise.all([
      this.prisma.storeMembershipProfile.findFirst({
        where: { storeId: store.id },
        select: { availablePoints: true },
      }),
      this.prisma.storePartner.findFirst({
        where: { storeId: store.id, deletedAt: null, status: 'approved' },
        select: { beanBalance: true },
      }),
    ]);

    const availablePoints = profile?.availablePoints ?? 0;
    const availableBeans = partner?.beanBalance ?? 0;

    const preview = this.calcPaymentPreview({
      planPrice: plan.price,
      requestedPoints,
      availablePoints,
      requestedBeans,
      availableBeans,
    });

    return {
      planId,
      planName: plan.name,
      originalPrice: plan.price,
      beanDeducted: preview.beanDeductAmount,
      beansUsed: preview.actualBeansUsed,
      priceAfterBeans: preview.priceAfterBeans,
      pointsDeducted: preview.pointsDeductAmount,
      pointsUsed: preview.actualPointsUsed,
      finalAmount: preview.finalAmount,
      bonusPoints: PURCHASE_BONUS_POINTS[planId] ?? 0,
      availablePoints,
      availableBeans,
    };
  }

  async getOrder(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<PulseMembershipOrderDetailResponseDto> {
    const store = await this.accessService.resolveTargetStoreForMembership(
      user,
      {
        notFoundMessage: '当前未选中目标门店，暂无法查看会员订单',
      },
    );

    const order = await this.prisma.storeMembershipOrder.findFirst({
      where: { id: orderId, storeId: store.id },
      select: {
        id: true,
        planId: true,
        planName: true,
        originalAmount: true,
        amount: true,
        pointsUsed: true,
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
      pointsUsed: order.pointsUsed,
      beansUsed: order.beansUsed,
      status: order.status as 'pending' | 'paid' | 'failed' | 'refunded',
      wxOrderId: order.paymentOrderId,
      createdAt: order.createdAt.getTime(),
      paidAt: order.paidAt ? order.paidAt.getTime() : null,
    };
  }

  async getOrderPayStatus(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<PulseMembershipOrderPayStatusResponseDto> {
    const store = await this.accessService.resolveTargetStoreForMembership(
      user,
      {
        notFoundMessage: '当前未选中目标门店，暂无法查看订单状态',
      },
    );

    const order = await this.prisma.storeMembershipOrder.findFirst({
      where: { id: orderId, storeId: store.id },
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

    const priceAfterBeans = Decimal.max(
      zero,
      planPriceDecimal.minus(beanDeductAmount),
    );

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
