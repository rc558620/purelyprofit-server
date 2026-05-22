import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import type {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipPlanResponseDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import type { PurchasePlatformMembershipOrderDto } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type {
  GetPulseAdminMembersQueryDto,
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
  PulseAdminMembersResponseDto,
  PulseMemberDetailDto,
  PulseMemberListItemDto,
  PulseMembershipOrderDetailResponseDto,
  PulseMembershipOrderPayStatusResponseDto,
  PulseMembershipOrderPreviewResponseDto,
} from './dto/pulse-membership.dto';
import { PulseMembershipOrderPreviewDto } from './dto/pulse-membership.dto';

const POINTS_RATE = 100;
const POINTS_DEDUCT_LIMIT = 0.3;
const BEAN_DEDUCT_RATE = 100;
const BEAN_DEDUCT_LIMIT = 0.5;

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

interface PulseAdminMembershipProfileRecord {
  currentPlanId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number] | null;
  expiresAt: Date | null;
  totalPoints: number;
  availablePoints: number;
}

interface PulseAdminMembershipOrderRecord {
  id: number;
  planId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];
  planName: string;
  amount: number;
  createdAt: Date;
}

interface PulseAdminStoreIdentityRecord {
  name: string;
  contactPhone: string | null;
  owner: {
    email: string;
    name: string | null;
    realName: string | null;
  };
}

interface PulseAdminStoreRecord extends PulseAdminStoreIdentityRecord {
  id: number;
  createdAt: Date;
  updatedAt: Date;
}

interface PulseAdminPartnerRecord {
  id: number;
  status: 'pending' | 'reviewing' | 'approved' | 'rejected';
  beanBalance: number;
  totalEarnedBeans: number;
  totalWithdrawnBeans: number;
}

interface PulseDeveloperPointsProfileRecord {
  storeId: number;
  currentPlanId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number] | null;
  expiresAt: Date | null;
  totalPoints: number;
  availablePoints: number;
}

interface PulseDeveloperPointsLogRecord {
  id: number;
  source: 'purchase_bonus' | 'deduct_payment' | 'admin_adjust' | 'expire';
  changeAmount: number;
  description: string;
  expireAt: Date | null;
  createdAt: Date;
}

interface PulseDeveloperBeanPartnerRecord {
  beanBalance: number;
  totalEarnedBeans: number;
  totalWithdrawnBeans: number;
}

interface PulseDeveloperBeanLogRecord {
  id: number;
  source: 'promo_reward' | 'deduct_payment' | 'withdrawal' | 'admin_adjust';
  changeAmount: number;
  description: string;
  relatedPromoRecordId: number | null;
  relatedPlanType: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number] | null;
  relatedUser: string | null;
  createdAt: Date;
}

interface PulseAdminMembershipMutationInput {
  userId?: string;
  memberId?: string;
  id?: string;
  level?: 'free' | 'monthly' | 'quarterly' | 'annual' | 'lifetime';
  memberLevel?: 'free' | 'monthly' | 'quarterly' | 'annual' | 'lifetime';
  membershipLevel?: 'free' | 'monthly' | 'quarterly' | 'annual' | 'lifetime';
  membershipExpiry?: number | null;
  expireAt?: number | null;
  expiryAt?: number | null;
}

interface PulseAdminStatusMutationInput {
  userId?: string;
  memberId?: string;
  id?: string;
  status?: 'active' | 'inactive' | 'banned';
  memberStatus?: 'active' | 'inactive' | 'banned';
  reason?: string;
  remark?: string;
}

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
  private readonly pulseDevAccountEmails: Set<string>;

  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly pulseStoreContextService: PulseStoreContextService,
    configService: ConfigService,
  ) {
    this.pulseDevAccountEmails = new Set(
      (configService.get<string[]>('pulse.devAccountEmails') ?? []).map((email) =>
        email.trim().toLowerCase(),
      ),
    );
  }

  listPlans(): PlatformMembershipPlanResponseDto[] {
    return this.platformMembershipService.listPlans();
  }

  async getCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipCenterResponseDto> {
    const store = await this.resolveTargetStoreForMembership(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看订阅中心',
    });
    return this.platformMembershipService.getCenterByStoreId(store.id);
  }

  async getProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipProfileResponseDto> {
    const store = await this.resolveTargetStoreForMembership(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看订阅档案',
    });
    return this.platformMembershipService.getProfileByStoreId(store.id);
  }

  async listOrders(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    const store = await this.resolveTargetStoreForMembership(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看订阅订单',
    });
    return this.platformMembershipService.listOrdersByStoreId(store.id);
  }

  async purchaseOrder(
    user: AuthenticatedUser,
    _dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    await this.resolveTargetStoreForMembership(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法发起订阅操作',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家创建订阅订单',
    );
  }

  async listPointsLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    const resolvedStore = await this.pulseStoreContextService.resolveTargetStore(user);
    if (resolvedStore.store) {
      return this.platformMembershipService.listPointsLogsByStoreId(
        resolvedStore.store.id,
      );
    }

    if (this.isDeveloper(user)) {
      return this.listDeveloperPointsLogs();
    }

    throw new NotFoundException('当前未选中目标商家门店，暂无法查看积分明细');
  }

  async listBeanLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    const resolvedStore = await this.pulseStoreContextService.resolveTargetStore(user);
    if (resolvedStore.store) {
      return this.platformMembershipService.listBeanLogsByStoreId(
        resolvedStore.store.id,
      );
    }

    if (this.isDeveloper(user)) {
      return this.listDeveloperBeanLogs();
    }

    throw new NotFoundException('当前未选中目标商家门店，暂无法查看纯利豆明细');
  }

  async listAdminPointsLogs(
    user: AuthenticatedUser,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    const storeIds = await this.resolveAdminMemberStoreIds(user);
    const logs = await this.prisma.storeMembershipPointsLog.findMany({
      where: {
        storeId: { in: storeIds },
      },
      select: {
        id: true,
        storeId: true,
        source: true,
        changeAmount: true,
        description: true,
        expireAt: true,
        createdAt: true,
        store: {
          select: {
            name: true,
            contactPhone: true,
            owner: {
              select: {
                email: true,
                name: true,
                realName: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return {
      items: logs.map((log) => {
        const userName = this.resolveAdminMemberDisplayName(log.store);
        const userPhone = this.maskAdminMemberPhone(
          this.resolveAdminMemberPhone(log.store),
        );
        const source = log.source as
          | 'purchase_bonus'
          | 'deduct_payment'
          | 'admin_adjust'
          | 'expire';

        return {
          id: String(log.id),
          userId: String(log.storeId),
          userName,
          userPhone,
          amount: log.changeAmount,
          type:
            source === 'expire'
              ? 'expire'
              : log.changeAmount > 0
                ? 'earn'
                : 'spend',
          source,
          description: log.description,
          createdAt: log.createdAt.getTime(),
          expireAt: log.expireAt ? log.expireAt.getTime() : null,
        };
      }),
    };
  }

  async listAdminBeanLogs(
    user: AuthenticatedUser,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    const storeIds = await this.resolveAdminMemberStoreIds(user);
    const logs = await this.prisma.storePartnerBeanLog.findMany({
      where: {
        storeId: { in: storeIds },
      },
      select: {
        id: true,
        storeId: true,
        source: true,
        changeAmount: true,
        description: true,
        relatedPromoRecordId: true,
        relatedUser: true,
        createdAt: true,
        store: {
          select: {
            name: true,
            contactPhone: true,
            owner: {
              select: {
                email: true,
                name: true,
                realName: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return {
      items: logs.map((log) => {
        const userName = this.resolveAdminMemberDisplayName(log.store);
        const userPhone = this.maskAdminMemberPhone(
          this.resolveAdminMemberPhone(log.store),
        );
        const source = log.source as
          | 'promo_reward'
          | 'deduct_payment'
          | 'withdrawal'
          | 'admin_adjust';

        return {
          id: String(log.id),
          userId: String(log.storeId),
          userName,
          userPhone,
          amount: log.changeAmount,
          type:
            source === 'withdrawal'
              ? 'withdraw'
              : log.changeAmount > 0
                ? 'earn'
                : 'spend',
          source,
          description: log.description,
          relatedPromoId: log.relatedPromoRecordId
            ? String(log.relatedPromoRecordId)
            : undefined,
          relatedUser: log.relatedUser ?? undefined,
          createdAt: log.createdAt.getTime(),
        };
      }),
    };
  }

  async getPromoCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    const store = await this.resolveTargetStoreForMembership(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看推广中心',
    });
    return this.platformMembershipService.getPromoCenterByStoreId(store.id);
  }

  async previewOrder(
    user: AuthenticatedUser,
    dto: PulseMembershipOrderPreviewDto,
  ): Promise<PulseMembershipOrderPreviewResponseDto> {
    const store = await this.pulseStoreContextService.resolveTargetStoreOrThrow(user, {
      notFoundMessage: '当前未选中目标门店，暂无法试算会员订单',
    });

    const planId = dto.planId;
    const planPrice = PLAN_PRICES[planId];
    const planName = PLAN_NAMES[planId];
    const requestedPoints = dto.usePoints ?? 0;
    const requestedBeans = dto.useBeans ?? 0;

    const [profile, partner] = await Promise.all([
      this.prisma.storeMembershipProfile.findFirst({
        where: { storeId: store.id },
        select: { availablePoints: true },
      }),
      this.prisma.storePartner.findFirst({
        where: { storeId: store.id, status: 'approved' },
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
      bonusPoints: PURCHASE_BONUS_POINTS[planId] ?? 0,
      availablePoints,
      availableBeans,
    };
  }

  async getOrder(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<PulseMembershipOrderDetailResponseDto> {
    const store = await this.pulseStoreContextService.resolveTargetStoreOrThrow(user, {
      notFoundMessage: '当前未选中目标门店，暂无法查看会员订单',
    });

    const order = await this.prisma.storeMembershipOrder.findFirst({
      where: { id: orderId, storeId: store.id },
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

  async getOrderPayStatus(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<PulseMembershipOrderPayStatusResponseDto> {
    const store = await this.pulseStoreContextService.resolveTargetStoreOrThrow(user, {
      notFoundMessage: '当前未选中目标门店，暂无法查看订单状态',
    });

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

  async listAdminMembers(
    user: AuthenticatedUser,
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    const storeIds = await this.resolveAdminMemberStoreIds(user);
    const members = (
      await Promise.all(storeIds.map((storeId) => this.buildAdminMemberDetail(storeId)))
    ).filter((member) => this.matchesAdminMemberFilters(member, query));

    return {
      items: members.map((member) => this.toAdminMemberListItem(member)),
      total: members.length,
    };
  }

  async getAdminMemberDetail(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    const canAccess = await this.canAccessAdminMember(user, memberId);
    if (!canAccess) {
      throw new NotFoundException('会员不存在');
    }

    return this.buildAdminMemberDetail(memberId);
  }

  async adjustAdminMemberPoints(
    user: AuthenticatedUser,
    memberId: number,
    dto: { delta?: number; amount?: number; direction?: 'add' | 'subtract' | 'deduct' | 'reduce'; reason: string },
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    const delta = this.resolveAdjustmentDelta(dto, '积分');
    const current = await this.loadAdminMemberStateOrThrow(memberId);
    const nextAvailablePoints = current.profile.availablePoints + delta;
    const nextTotalPoints =
      current.profile.totalPoints + (delta > 0 ? delta : 0);

    if (nextAvailablePoints < 0) {
      throw new BadRequestException('当前积分不足，无法扣减');
    }

    await this.prisma.$transaction(async (tx) => {
      const profile = await tx.storeMembershipProfile.upsert({
        where: { storeId: memberId },
        create: {
          storeId: memberId,
          totalPoints: nextTotalPoints,
          availablePoints: nextAvailablePoints,
        },
        update: {
          totalPoints: nextTotalPoints,
          availablePoints: nextAvailablePoints,
        },
        select: { id: true },
      });

      await tx.storeMembershipPointsLog.create({
        data: {
          storeId: memberId,
          profileId: profile.id,
          source: 'admin_adjust',
          changeAmount: delta,
          description: dto.reason.trim(),
        },
      });
    });

    return this.buildAdminMemberDetail(memberId);
  }

  async adjustAdminMemberBeans(
    user: AuthenticatedUser,
    memberId: number,
    dto: { delta?: number; amount?: number; direction?: 'add' | 'subtract' | 'deduct' | 'reduce'; reason: string },
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    const delta = this.resolveAdjustmentDelta(dto, '纯利豆');
    const current = await this.loadAdminMemberStateOrThrow(memberId);
    const nextBeanBalance = current.partner.beanBalance + delta;

    if (nextBeanBalance < 0) {
      throw new BadRequestException('当前纯利豆不足，无法扣减');
    }

    await this.prisma.$transaction(async (tx) => {
      const partner = await tx.storePartner.upsert({
        where: { storeId: memberId },
        create: {
          storeId: memberId,
          status: 'approved',
          reviewedAt: new Date(),
          joinedAt: new Date(),
          beanBalance: nextBeanBalance,
          totalEarnedBeans: Math.max(current.partner.totalEarnedBeans + (delta > 0 ? delta : 0), 0),
          totalWithdrawnBeans: current.partner.totalWithdrawnBeans,
        },
        update: {
          status: 'approved',
          reviewedAt: current.partner.status === 'approved' ? undefined : new Date(),
          joinedAt: current.partner.status === 'approved' ? undefined : new Date(),
          beanBalance: nextBeanBalance,
          totalEarnedBeans: Math.max(current.partner.totalEarnedBeans + (delta > 0 ? delta : 0), 0),
        },
        select: { id: true },
      });

      await tx.storePartnerBeanLog.create({
        data: {
          storeId: memberId,
          partnerId: partner.id,
          source: 'admin_adjust',
          changeAmount: delta,
          description: dto.reason.trim(),
        },
      });
    });

    return this.buildAdminMemberDetail(memberId);
  }

  async setAdminMemberMembership(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminMembershipMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    const nextLevel = this.resolveAdminMemberLevel(dto);
    const nextExpiry = this.resolveAdminMembershipExpiry(dto, nextLevel);
    const nextPlanId = this.toMembershipPlanId(nextLevel);
    const now = new Date();

    await this.prisma.storeMembershipProfile.upsert({
      where: { storeId: memberId },
      create: {
        storeId: memberId,
        currentPlanId: nextPlanId,
        startsAt: nextPlanId ? now : null,
        expiresAt: nextExpiry,
        totalPoints: 0,
        availablePoints: 0,
      },
      update: {
        currentPlanId: nextPlanId,
        startsAt: nextPlanId ? now : null,
        expiresAt: nextExpiry,
      },
    });

    return this.buildAdminMemberDetail(memberId);
  }

  async banAdminMember(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminStatusMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    const reason = this.resolveBanReason(dto);
    await this.prisma.store.update({
      where: { id: memberId },
      data: {
        updatedAt: new Date(),
      },
    });

    const cacheKey = this.getAdminMemberBanReasonKey(memberId);
    await this.writeAdminMemberBanReason(cacheKey, reason);

    return this.buildAdminMemberDetail(memberId);
  }

  async unbanAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    await this.prisma.store.update({
      where: { id: memberId },
      data: {
        updatedAt: new Date(),
      },
    });

    await this.clearAdminMemberBanReason(this.getAdminMemberBanReasonKey(memberId));

    return this.buildAdminMemberDetail(memberId);
  }

  private async resolveAdminMemberStoreIds(
    user: AuthenticatedUser,
  ): Promise<number[]> {
    if (this.isDeveloper(user)) {
      const profiles = await this.prisma.storeMembershipProfile.findMany({
        where: {
          currentPlanId: {
            not: null,
          },
          store: this.buildAdminStoreExclusionWhere(),
        },
        select: {
          storeId: true,
        },
        orderBy: {
          storeId: 'asc',
        },
      });

      return profiles.map((profile) => profile.storeId);
    }

    if (user.currentMembership?.storeId) {
      return [user.currentMembership.storeId];
    }

    const resolvedStore = await this.pulseStoreContextService.resolveTargetStore(user);
    return resolvedStore.store ? [resolvedStore.store.id] : [];
  }

  private async canAccessAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<boolean> {
    if (this.isDeveloper(user)) {
      return !(await this.isExcludedAdminStore(memberId));
    }

    if (user.currentMembership?.storeId === memberId) {
      return true;
    }

    const resolvedStore = await this.pulseStoreContextService.resolveTargetStore(user);
    return resolvedStore.store?.id === memberId;
  }

  private isDeveloper(user: AuthenticatedUser): boolean {
    return user.isPulseDeveloper === true || user.pulseMode === 'developer';
  }

  private buildAdminStoreExclusionWhere(): {
    owner?: {
      email?: {
        notIn: string[];
      };
    };
  } {
    const excludedEmails = Array.from(this.pulseDevAccountEmails);
    if (excludedEmails.length === 0) {
      return {};
    }

    return {
      owner: {
        email: {
          notIn: excludedEmails,
        },
      },
    };
  }

  private async isExcludedAdminStore(storeId: number): Promise<boolean> {
    if (this.pulseDevAccountEmails.size === 0) {
      return false;
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        owner: {
          select: {
            email: true,
          },
        },
      },
    });

    return store
      ? this.pulseDevAccountEmails.has(store.owner.email.trim().toLowerCase())
      : false;
  }

  private async listDeveloperPointsLogs(): Promise<PlatformMembershipPointsLogsResponseDto> {
    const [profiles, logs]: [
      PulseDeveloperPointsProfileRecord[],
      PulseDeveloperPointsLogRecord[],
    ] = await Promise.all([
      this.prisma.storeMembershipProfile.findMany({
        where: {
          store: this.buildAdminStoreExclusionWhere(),
        },
        select: {
          storeId: true,
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      }),
      this.prisma.storeMembershipPointsLog.findMany({
        where: {
          store: this.buildAdminStoreExclusionWhere(),
        },
        select: {
          id: true,
          source: true,
          changeAmount: true,
          description: true,
          expireAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const totalPoints = profiles.reduce(
      (sum, profile) => sum + profile.totalPoints,
      0,
    );
    const availablePoints = profiles.reduce(
      (sum, profile) => sum + profile.availablePoints,
      0,
    );
    const now = Date.now();
    const activeProfile = profiles.find((profile) => {
      const expiredAt = profile.expiresAt?.getTime() ?? null;
      return expiredAt !== null && expiredAt > now;
    });

    return {
      memberInfo: {
        isActive: activeProfile !== undefined,
        planId: null,
        expiredAt: null,
        inviteCode: 'PULSE',
        totalPoints,
        availablePoints,
      },
      overview: {
        availablePoints,
        totalEarned: logs.reduce(
          (sum, log) => (log.changeAmount > 0 ? sum + log.changeAmount : sum),
          0,
        ),
        totalSpent: logs.reduce(
          (sum, log) =>
            log.changeAmount < 0 ? sum + Math.abs(log.changeAmount) : sum,
          0,
        ),
      },
      items: logs.map((log) => this.mapDeveloperPointsLog(log)),
    };
  }

  private mapDeveloperPointsLog(
    log: PulseDeveloperPointsLogRecord,
  ): PlatformMembershipPointsLogsResponseDto['items'][number] {
    const type: PlatformMembershipPointsLogsResponseDto['items'][number]['type'] =
      log.source === 'expire'
        ? 'expire'
        : log.changeAmount > 0
          ? 'earn'
          : 'spend';

    return {
      id: `pts-${log.id}`,
      amount: log.changeAmount,
      type,
      source: log.source,
      description: log.description,
      createdAt: log.createdAt.getTime(),
      expireAt: log.expireAt ? log.expireAt.getTime() : undefined,
    };
  }

  private async listDeveloperBeanLogs(): Promise<PlatformMembershipBeanLogsResponseDto> {
    const [partners, logs]: [
      PulseDeveloperBeanPartnerRecord[],
      PulseDeveloperBeanLogRecord[],
    ] = await Promise.all([
      this.prisma.storePartner.findMany({
        where: {
          status: 'approved',
          store: this.buildAdminStoreExclusionWhere(),
        },
        select: {
          beanBalance: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
      }),
      this.prisma.storePartnerBeanLog.findMany({
        where: {
          store: this.buildAdminStoreExclusionWhere(),
        },
        select: {
          id: true,
          source: true,
          changeAmount: true,
          description: true,
          relatedPromoRecordId: true,
          relatedPlanType: true,
          relatedUser: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const overview = partners.reduce(
      (summary, partner) => ({
        beanBalance: summary.beanBalance + partner.beanBalance,
        totalEarnedBeans: summary.totalEarnedBeans + partner.totalEarnedBeans,
        totalWithdrawnBeans:
          summary.totalWithdrawnBeans + partner.totalWithdrawnBeans,
      }),
      {
        beanBalance: 0,
        totalEarnedBeans: 0,
        totalWithdrawnBeans: 0,
      },
    );

    return {
      approvedPartner: null,
      overview,
      items: logs.map((log) => this.mapDeveloperBeanLog(log)),
    };
  }

  private mapDeveloperBeanLog(
    log: PulseDeveloperBeanLogRecord,
  ): PlatformMembershipBeanLogsResponseDto['items'][number] {
    const type: PlatformMembershipBeanLogsResponseDto['items'][number]['type'] =
      log.source === 'withdrawal'
        ? 'withdraw'
        : log.changeAmount > 0
          ? 'earn'
          : 'spend';

    return {
      id: String(log.id),
      amount: log.changeAmount,
      type,
      source: log.source,
      description: log.description,
      relatedPromoId: log.relatedPromoRecordId
        ? String(log.relatedPromoRecordId)
        : undefined,
      relatedPlanType: log.relatedPlanType ?? undefined,
      relatedUser: log.relatedUser ?? undefined,
      createdAt: log.createdAt.getTime(),
    };
  }

  private resolveTargetStoreForMembership(
    user: AuthenticatedUser,
    options?: {
      notFoundMessage?: string;
    },
  ) {
    return this.pulseStoreContextService.resolveTargetStoreOrThrow(user, {
      notFoundMessage:
        options?.notFoundMessage ??
        '当前未选中目标商家门店，暂无法使用订阅中心',
    });
  }

  private async buildAdminMemberDetail(
    storeId: number,
  ): Promise<PulseMemberDetailDto> {
    const banReason = await this.getAdminMemberBanReason(
      this.getAdminMemberBanReasonKey(storeId),
    );
    const [store, profile, paidOrders, partner, promoCount] = await Promise.all([
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: {
          id: true,
          name: true,
          contactPhone: true,
          createdAt: true,
          updatedAt: true,
          owner: {
            select: {
              email: true,
              name: true,
              realName: true,
            },
          },
        },
      }),
      this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: {
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      }),
      this.prisma.storeMembershipOrder.findMany({
        where: { storeId, status: 'paid' },
        select: {
          id: true,
          planId: true,
          planName: true,
          amount: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.storePartner.findFirst({
        where: { storeId },
        select: {
          beanBalance: true,
          status: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
      }),
      this.prisma.storeMembershipPromoRecord.count({
        where: { storeId },
      }),
    ]);

    if (!store) {
      throw new NotFoundException('目标门店不存在');
    }

    const ownerName = this.resolveAdminMemberDisplayName(store);
    const phone = this.resolveAdminMemberPhone(store);
    const currentPlanId = profile?.currentPlanId ?? null;
    const level = this.toPulseMemberLevel(currentPlanId, profile?.expiresAt ?? null);
    const membershipExpiry = profile?.expiresAt?.getTime() ?? null;
    const isBanned = Boolean(banReason);
    const isActive = membershipExpiry !== null && membershipExpiry > Date.now();
    const registeredAt = store.createdAt.getTime();
    const lastActiveAt =
      paidOrders[0]?.createdAt.getTime() ??
      profile?.expiresAt?.getTime() ??
      store.updatedAt.getTime();
    const totalRecharged = paidOrders.reduce(
      (sum, order) => sum + order.amount,
      0,
    );

    return {
      id: String(store.id),
      name: ownerName,
      phone,
      avatarChar: ownerName.slice(0, 1) || '会',
      avatarColorIdx: store.id % 6,
      status: isBanned ? 'banned' : isActive ? 'active' : 'inactive',
      level,
      registeredAt,
      lastActiveAt,
      availablePoints: profile?.availablePoints ?? 0,
      totalPointsEarned: profile?.totalPoints ?? 0,
      beanBalance: partner?.beanBalance ?? 0,
      isPartner: partner?.status === 'approved',
      totalRecharged,
      rechargeCount: paidOrders.length,
      invitedCount: promoCount,
      rechargeHistory: paidOrders.map((order) => ({
        id: String(order.id),
        planName: order.planName,
        amount: order.amount,
        pointsAwarded: PURCHASE_BONUS_POINTS[order.planId] ?? 0,
        channel: 'wechat',
        createdAt: order.createdAt.getTime(),
      })),
      remark: banReason ?? `${store.name} 的平台会员档案`,
      membershipExpiry,
    };
  }

  private async assertAdminMemberMutationAccess(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<void> {
    if (!this.isDeveloper(user)) {
      throw new ForbiddenException('仅开发者可执行 Pulse 会员管理修改操作');
    }

    const canAccess = await this.canAccessAdminMember(user, memberId);
    if (!canAccess) {
      throw new NotFoundException('会员不存在');
    }
  }

  private async loadAdminMemberStateOrThrow(storeId: number): Promise<{
    profile: PulseAdminMembershipProfileRecord;
    partner: PulseAdminPartnerRecord;
  }> {
    const [store, profile, partner] = await Promise.all([
      this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true } }),
      this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: {
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      }),
      this.prisma.storePartner.findUnique({
        where: { storeId },
        select: {
          id: true,
          status: true,
          beanBalance: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
      }),
    ]);

    if (!store) {
      throw new NotFoundException('会员不存在');
    }

    return {
      profile: profile ?? {
        currentPlanId: null,
        expiresAt: null,
        totalPoints: 0,
        availablePoints: 0,
      },
      partner: partner ?? {
        id: 0,
        status: 'approved',
        beanBalance: 0,
        totalEarnedBeans: 0,
        totalWithdrawnBeans: 0,
      },
    };
  }

  private resolveAdjustmentDelta(
    input: { delta?: number; amount?: number; direction?: 'add' | 'subtract' | 'deduct' | 'reduce' },
    assetLabel: string,
  ): number {
    if (typeof input.delta === 'number' && input.delta !== 0) {
      return input.delta;
    }

    if (typeof input.amount !== 'number' || input.amount === 0) {
      throw new BadRequestException(`缺少${assetLabel}调整值`);
    }

    switch (input.direction) {
      case 'add':
        return Math.abs(input.amount);
      case 'subtract':
      case 'deduct':
      case 'reduce':
        return -Math.abs(input.amount);
      default:
        return input.amount;
    }
  }

  private resolveAdminMemberLevel(
    dto: PulseAdminMembershipMutationInput,
  ): 'free' | 'monthly' | 'quarterly' | 'annual' | 'lifetime' {
    const nextLevel = dto.level ?? dto.memberLevel ?? dto.membershipLevel;
    if (!nextLevel) {
      throw new BadRequestException('缺少会员等级');
    }

    return nextLevel;
  }

  private resolveAdminMembershipExpiry(
    dto: PulseAdminMembershipMutationInput,
    nextLevel: 'free' | 'monthly' | 'quarterly' | 'annual' | 'lifetime',
  ): Date | null {
    if (nextLevel === 'free' || nextLevel === 'lifetime') {
      return null;
    }

    const rawExpiry = dto.membershipExpiry ?? dto.expireAt ?? dto.expiryAt;
    if (rawExpiry === null || rawExpiry === undefined) {
      throw new BadRequestException('缺少会员到期时间');
    }

    const expiry = new Date(rawExpiry);
    if (Number.isNaN(expiry.getTime())) {
      throw new BadRequestException('会员到期时间不合法');
    }

    return expiry;
  }

  private toMembershipPlanId(
    level: 'free' | 'monthly' | 'quarterly' | 'annual' | 'lifetime',
  ): (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number] | null {
    switch (level) {
      case 'monthly':
        return 'monthly';
      case 'quarterly':
        return 'quarterly';
      case 'annual':
      case 'lifetime':
        return 'yearly';
      default:
        return null;
    }
  }

  private resolveBanReason(dto: PulseAdminStatusMutationInput): string {
    const reason = dto.reason?.trim() ?? dto.remark?.trim() ?? '';
    if (!reason) {
      throw new BadRequestException('缺少封禁原因');
    }

    return reason;
  }

  private getAdminMemberBanReasonKey(storeId: number): string {
    return `pulse:membership:admin:member:${storeId}:ban-reason`;
  }

  private async getAdminMemberBanReason(key: string): Promise<string | null> {
    return this.redisService.get(key);
  }

  private async writeAdminMemberBanReason(key: string, reason: string): Promise<void> {
    await this.redisService.set(key, reason);
  }

  private async clearAdminMemberBanReason(key: string): Promise<void> {
    await this.redisService.del(key);
  }

  private toAdminMemberListItem(
    detail: PulseMemberDetailDto,
  ): PulseMemberListItemDto {
    return {
      id: detail.id,
      name: detail.name,
      phone: detail.phone,
      avatarChar: detail.avatarChar,
      avatarColorIdx: detail.avatarColorIdx,
      status: detail.status,
      level: detail.level,
      availablePoints: detail.availablePoints,
      beanBalance: detail.beanBalance,
      isPartner: detail.isPartner,
      totalRecharged: detail.totalRecharged,
      registeredAt: detail.registeredAt,
      lastActiveAt: detail.lastActiveAt,
    };
  }

  private matchesAdminMemberFilters(
    member: PulseMemberDetailDto,
    query: GetPulseAdminMembersQueryDto,
  ): boolean {
    if (query.status && query.status !== 'all' && member.status !== query.status) {
      return false;
    }

    if (query.level && query.level !== 'all' && member.level !== query.level) {
      return false;
    }

    if (query.partner === true && !member.isPartner) {
      return false;
    }

    const keyword = query.keyword?.trim().toLowerCase();
    if (!keyword) {
      return true;
    }

    return (
      member.name.toLowerCase().includes(keyword) ||
      member.phone.toLowerCase().includes(keyword)
    );
  }

  private resolveAdminMemberDisplayName(
    store: Pick<PulseAdminStoreIdentityRecord, 'name' | 'owner'>,
  ): string {
    return store.owner.realName ?? store.owner.name ?? store.name;
  }

  private resolveAdminMemberPhone(
    store: Pick<PulseAdminStoreIdentityRecord, 'contactPhone' | 'owner'>,
  ): string {
    const contactPhone = store.contactPhone?.trim();
    if (contactPhone) {
      return contactPhone;
    }

    const ownerEmail = store.owner.email.trim().toLowerCase();
    const matchedPhone = /^phone_(\d{11})@purelyprofit\.local$/.exec(ownerEmail);
    return matchedPhone?.[1] ?? '';
  }

  private maskAdminMemberPhone(phone: string): string {
    const normalizedPhone = phone.replace(/\s+/g, '');
    if (!/^1\d{10}$/.test(normalizedPhone)) {
      return normalizedPhone || '--';
    }

    return `${normalizedPhone.slice(0, 3)}****${normalizedPhone.slice(-4)}`;
  }

  private toPulseMemberLevel(
    planId: PulseAdminMembershipProfileRecord['currentPlanId'],
    expiresAt: Date | null,
  ): 'free' | 'monthly' | 'quarterly' | 'annual' | 'lifetime' {
    if (planId === 'yearly' && expiresAt === null) {
      return 'lifetime';
    }

    switch (planId) {
      case 'monthly':
        return 'monthly';
      case 'quarterly':
        return 'quarterly';
      case 'yearly':
        return 'annual';
      default:
        return 'free';
    }
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
