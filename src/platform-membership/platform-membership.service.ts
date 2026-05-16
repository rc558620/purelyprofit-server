import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplyPlatformPartnerDto,
  CreatePlatformPartnerFollowUpNoteDto,
  type PlatformMembershipPlanId,
  PurchasePlatformMembershipOrderDto,
  RejectPlatformPartnerApplicationDto,
} from './dto/platform-membership-query.dto';
import {
  type PlatformMembershipBeanLogsResponseDto,
  type PlatformMembershipBeanLogDto,
  type PlatformMembershipCenterResponseDto,
  type PlatformMembershipOrderResponseDto,
  type PlatformMembershipOrdersOverviewDto,
  type PlatformMembershipOrdersResponseDto,
  type PlatformMembershipPartnerApplicationDto,
  type PlatformMembershipPartnerFollowUpNoteDto,
  type PlatformMembershipPartnerLevelDto,
  type PlatformMembershipPartnerProfileResponseDto,
  type PlatformMembershipPlanResponseDto,
  type PlatformMembershipPointsLogDto,
  type PlatformMembershipPointsLogsResponseDto,
  type PlatformMembershipProfileResponseDto,
  type PlatformMembershipPromoCenterResponseDto,
  type PlatformMembershipPromoRecordDto,
  type PlatformMembershipPromoStatsDto,
  PurchasePlatformMembershipOrderResponseDto,
} from './dto/platform-membership-response.dto';

interface MembershipPlanConfig {
  id: PlatformMembershipPlanId;
  name: string;
  price: number;
  originalPrice: number;
  durationMonths: number;
  badge?: string;
  recommended?: boolean;
  monthlyPrice: number;
}

interface StoreMembershipProfileRecord {
  id: number;
  storeId: number;
  currentPlanId: PlatformMembershipPlanId | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  totalPoints: number;
  availablePoints: number;
}

interface StoreMembershipOrderRecord {
  id: number;
  planId: PlatformMembershipPlanId;
  planName: string;
  amount: number;
  pointsDeducted: number;
  pointsUsed: number;
  beanDeducted: number;
  beansUsed: number;
  status: MembershipOrderStatusValue;
  paymentChannel: 'wechat';
  paymentOrderId: string | null;
  createdAt: Date;
}

interface StoreMembershipPointsLogRecord {
  id: number;
  source: PointsSourceValue;
  changeAmount: number;
  description: string;
  expireAt: Date | null;
  createdAt: Date;
}

interface StoreMembershipPromoRecord {
  id: number;
  inviteeName: string;
  inviteePhone: string;
  registeredAt: Date;
  hasCharged: boolean;
  chargedAmount: number | null;
  chargedAt: Date | null;
  chargedPlan: PlatformMembershipPlanId | null;
  rewardBeans: number | null;
  settled: boolean;
}

interface StorePartnerRecord {
  id: number;
  status: PartnerStatusValue;
  name: string | null;
  phone: string | null;
  idCard: string | null;
  region: string[];
  intention: PartnerIntentionValue | null;
  applyReason: string | null;
  paymentAccountType: PartnerPaymentMethodValue | null;
  paymentAccountNo: string | null;
  paymentAccountName: string | null;
  beanBalance: number;
  totalEarnedBeans: number;
  totalWithdrawnBeans: number;
  joinedAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

interface StorePartnerApplicationNoteRecord {
  id: number;
  content: string;
  createdAt: Date;
}

interface StorePartnerApplicationRecord {
  id: number;
  storeId: number;
  status: PartnerStatusValue;
  name: string;
  phone: string;
  idCard: string;
  region: string[];
  intention: PartnerIntentionValue;
  applyReason: string | null;
  paymentAccountType: PartnerPaymentMethodValue;
  paymentAccountNo: string;
  paymentAccountName: string;
  reviewedAt: Date | null;
  joinedAt: Date | null;
  createdAt: Date;
  followUpNotes: StorePartnerApplicationNoteRecord[];
}

interface StorePartnerBeanLogRecord {
  id: number;
  source: BeanSourceValue;
  changeAmount: number;
  description: string;
  relatedPromoRecordId: number | null;
  relatedUser: string | null;
  relatedPlanType: PlatformMembershipPlanId | null;
  createdAt: Date;
}

interface PaymentCalculationResult {
  beanDeductAmount: number;
  actualBeansUsed: number;
  priceAfterBeans: number;
  pointsDeductAmount: number;
  actualPointsUsed: number;
  finalAmount: number;
}

interface PartnerSnapshotPayload {
  name: string;
  phone: string;
  idCard: string;
  region: string[];
  intention: PartnerIntentionValue;
  applyReason: string | null;
  paymentAccountType: PartnerPaymentMethodValue;
  paymentAccountNo: string;
  paymentAccountName: string;
}

type PrismaExecutor = PrismaService | Prisma.TransactionClient;
type MembershipOrderStatusValue = 'pending' | 'paid' | 'failed' | 'refunded';
type PartnerStatusValue = 'pending' | 'reviewing' | 'approved' | 'rejected';
type PartnerIntentionValue = 'agent' | 'invest' | 'resource' | 'other';
type PartnerPaymentMethodValue = 'wechat' | 'alipay' | 'bank';
type PointsSourceValue =
  | 'purchase_bonus'
  | 'deduct_payment'
  | 'admin_adjust'
  | 'expire';
type PointsTypeValue = 'earn' | 'spend' | 'expire';
type BeanSourceValue =
  | 'promo_reward'
  | 'deduct_payment'
  | 'withdrawal'
  | 'admin_adjust';
type BeanTypeValue = 'earn' | 'spend' | 'withdraw';
type PartnerLevelValue = 'star' | 'elite' | 'legend';

const DAY_MS = 24 * 60 * 60 * 1000;
const POINTS_RATE = 100;
const POINTS_DEDUCT_LIMIT = 0.3;
const BEAN_DEDUCT_RATE = 100;
const BEAN_DEDUCT_LIMIT = 0.5;
const PURCHASE_BONUS_POINTS: Record<PlatformMembershipPlanId, number> = {
  monthly: 0,
  quarterly: 300,
  yearly: 1500,
};
const PLAN_CATALOG: MembershipPlanConfig[] = [
  {
    id: 'monthly',
    name: '月度会员',
    price: 3800,
    originalPrice: 3800,
    durationMonths: 1,
    monthlyPrice: 3800,
  },
  {
    id: 'quarterly',
    name: '季度会员',
    price: 9900,
    originalPrice: 11400,
    durationMonths: 3,
    badge: '省15元',
    recommended: true,
    monthlyPrice: 3300,
  },
  {
    id: 'yearly',
    name: '年度会员',
    price: 36900,
    originalPrice: 45600,
    durationMonths: 12,
    badge: '最划算',
    monthlyPrice: 3075,
  },
];

@Injectable()
export class PlatformMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  listPlans(): PlatformMembershipPlanResponseDto[] {
    return PLAN_CATALOG.map((plan) => ({ ...plan }));
  }

  async getCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipCenterResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const [profile, partner, paidOrderCount, promoRecords, applications] =
      await Promise.all([
        this.ensureProfile(this.prisma, storeId),
        this.findPartner(this.prisma, storeId),
        this.prisma.storeMembershipOrder.count({
          where: { storeId, status: 'paid' },
        }),
        this.findPromoRecords(this.prisma, storeId),
        this.findPartnerApplications(this.prisma, storeId),
      ]);

    const profileResponse = this.buildProfileResponse(profile, partner);

    return {
      memberInfo: profileResponse.memberInfo,
      remainingDays: this.calcRemainingDays(profile.expiresAt),
      stats: this.buildCenterStats(promoRecords),
      paidOrderCount,
      myPartnerApplication: this.buildCurrentPartnerApplication(
        applications,
        partner,
      ),
      approvedPartner: profileResponse.approvedPartner,
    };
  }

  async getProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipProfileResponseDto> {
    const center = await this.getCenter(user);
    return {
      memberInfo: center.memberInfo,
      approvedPartner: center.approvedPartner,
    };
  }

  async listOrders(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    await this.ensureProfile(this.prisma, storeId);

    const orders = await this.prisma.storeMembershipOrder.findMany({
      where: { storeId },
      select: {
        id: true,
        planId: true,
        planName: true,
        amount: true,
        pointsDeducted: true,
        pointsUsed: true,
        beanDeducted: true,
        beansUsed: true,
        status: true,
        paymentChannel: true,
        paymentOrderId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return {
      overview: this.buildOrdersOverview(orders),
      items: orders.map((order) => this.mapOrder(order)),
    };
  }

  async purchaseOrder(
    user: AuthenticatedUser,
    dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    await this.ensureStoreOwner(user, storeId);

    const plan = this.requirePlan(dto.planId);
    const requestedPoints = dto.usePoints ?? 0;
    const requestedBeans = dto.useBeans ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const profile = await this.ensureProfile(tx, storeId);
      const partner = await this.findPartner(tx, storeId);
      const approvedPartner = this.requireApprovedPartnerOrNull(partner);
      const payment = this.calcMemberPlanPayment({
        planPrice: plan.price,
        requestedPoints,
        availablePoints: profile.availablePoints,
        requestedBeans,
        availableBeans: approvedPartner?.beanBalance ?? 0,
        pointsRate: POINTS_RATE,
        pointsDeductLimitRate: POINTS_DEDUCT_LIMIT,
        beanDeductRate: BEAN_DEDUCT_RATE,
        beanDeductLimitRate: BEAN_DEDUCT_LIMIT,
      });

      if (requestedPoints > 0 && payment.actualPointsUsed === 0) {
        throw new ConflictException('当前无可抵扣积分');
      }

      if (requestedBeans > 0 && payment.actualBeansUsed === 0) {
        throw new ConflictException('当前无可抵扣纯利豆');
      }

      if (payment.actualBeansUsed > 0 && approvedPartner !== null) {
        const partnerUpdateResult = await tx.storePartner.updateMany({
          where: {
            id: approvedPartner.id,
            storeId,
            status: 'approved',
            beanBalance: { gte: payment.actualBeansUsed },
          },
          data: {
            beanBalance: { decrement: payment.actualBeansUsed },
          },
        });

        if (partnerUpdateResult.count !== 1) {
          throw new ConflictException('纯利豆余额不足，请刷新后重试');
        }

        await tx.storePartnerBeanLog.create({
          data: {
            storeId,
            partnerId: approvedPartner.id,
            source: 'deduct_payment',
            changeAmount: -payment.actualBeansUsed,
            description: `纯利豆抵扣 · 订阅${plan.name}`,
            relatedPlanType: plan.id,
          },
        });
      }

      const bonusPoints = PURCHASE_BONUS_POINTS[plan.id] ?? 0;
      const nextAvailablePoints =
        profile.availablePoints - payment.actualPointsUsed + bonusPoints;
      const nextTotalPoints =
        profile.totalPoints - payment.actualPointsUsed + bonusPoints;
      const now = new Date();
      const currentExpiryMs = profile.expiresAt?.getTime() ?? 0;
      const baseMs =
        currentExpiryMs > now.getTime() ? currentExpiryMs : now.getTime();
      const nextExpiresAt = new Date(
        baseMs + plan.durationMonths * 30 * DAY_MS,
      );

      const updatedProfile = await tx.storeMembershipProfile.update({
        where: { id: profile.id },
        data: {
          currentPlanId: plan.id,
          startsAt: profile.startsAt ?? now,
          expiresAt: nextExpiresAt,
          totalPoints: nextTotalPoints,
          availablePoints: nextAvailablePoints,
        },
        select: {
          id: true,
          storeId: true,
          currentPlanId: true,
          startsAt: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      });

      if (payment.actualPointsUsed > 0) {
        await tx.storeMembershipPointsLog.create({
          data: {
            storeId,
            profileId: profile.id,
            source: 'deduct_payment',
            changeAmount: -payment.actualPointsUsed,
            description: `订阅${plan.name}抵扣`,
          },
        });
      }

      if (bonusPoints > 0) {
        await tx.storeMembershipPointsLog.create({
          data: {
            storeId,
            profileId: profile.id,
            source: 'purchase_bonus',
            changeAmount: bonusPoints,
            description: `购买${plan.name}赠积分`,
          },
        });
      }

      const order = await tx.storeMembershipOrder.create({
        data: {
          storeId,
          profileId: profile.id,
          planId: plan.id,
          planName: plan.name,
          originalAmount: plan.price,
          pointsDeducted: payment.pointsDeductAmount,
          pointsUsed: payment.actualPointsUsed,
          beanDeducted: payment.beanDeductAmount,
          beansUsed: payment.actualBeansUsed,
          amount: payment.finalAmount,
          status: 'paid',
          paymentChannel: 'wechat',
          paymentOrderId: this.generateWechatOrderId(storeId, now),
          paidAt: now,
        },
        select: {
          id: true,
          planId: true,
          planName: true,
          amount: true,
          pointsDeducted: true,
          pointsUsed: true,
          beanDeducted: true,
          beansUsed: true,
          status: true,
          paymentChannel: true,
          paymentOrderId: true,
          createdAt: true,
        },
      });

      const latestPartner = await this.findPartner(tx, storeId);
      const allOrders = await tx.storeMembershipOrder.findMany({
        where: { storeId },
        select: {
          id: true,
          planId: true,
          planName: true,
          amount: true,
          pointsDeducted: true,
          pointsUsed: true,
          beanDeducted: true,
          beansUsed: true,
          status: true,
          paymentChannel: true,
          paymentOrderId: true,
          createdAt: true,
        },
      });

      return {
        order: this.mapOrder(order),
        profile: this.buildProfileResponse(updatedProfile, latestPartner),
        overview: this.buildOrdersOverview(allOrders),
      };
    });
  }

  async listPointsLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const profile = await this.ensureProfile(this.prisma, storeId);
    const logs = await this.prisma.storeMembershipPointsLog.findMany({
      where: { storeId },
      select: {
        id: true,
        source: true,
        changeAmount: true,
        description: true,
        expireAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const memberInfo = this.buildMembershipInfo(profile);

    return {
      memberInfo,
      overview: this.buildPointsOverview(memberInfo.availablePoints, logs),
      items: logs.map((log) => this.mapPointsLog(log)),
    };
  }

  async listBeanLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const partner = await this.findPartner(this.prisma, storeId);
    const logs = partner
      ? await this.prisma.storePartnerBeanLog.findMany({
          where: { storeId, partnerId: partner.id },
          select: {
            id: true,
            source: true,
            changeAmount: true,
            description: true,
            relatedPromoRecordId: true,
            relatedUser: true,
            relatedPlanType: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
      : [];

    return {
      approvedPartner: this.buildApprovedPartnerResponse(partner),
      overview: this.buildBeanOverview(partner),
      items: logs.map((log) => this.mapBeanLog(log)),
    };
  }

  async getPromoCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const [profile, partner, promoRecords] = await Promise.all([
      this.ensureProfile(this.prisma, storeId),
      this.findPartner(this.prisma, storeId),
      this.findPromoRecords(this.prisma, storeId),
    ]);
    const statsByPeriod = this.buildPromoStatsByPeriod(promoRecords);

    return {
      memberInfo: this.buildMembershipInfo(profile),
      approvedPartner: this.buildApprovedPartnerResponse(partner),
      level: this.buildPartnerLevel(partner, promoRecords),
      stats: statsByPeriod.all,
      statsByPeriod,
      items: promoRecords.map((record) => this.mapPromoRecord(record)),
    };
  }

  async getPartnerProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.buildPartnerProfile(this.prisma, storeId);
  }

  async applyPartner(
    user: AuthenticatedUser,
    dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    await this.ensureStoreOwner(user, storeId);

    const [existingPartner, applications] = await Promise.all([
      this.findPartner(this.prisma, storeId),
      this.findPartnerApplications(this.prisma, storeId),
    ]);
    const currentApplication = this.buildCurrentPartnerApplication(
      applications,
      existingPartner,
    );

    if (existingPartner?.status === 'approved') {
      throw new ConflictException('当前门店已成为合伙人，无需重复申请');
    }

    if (
      currentApplication &&
      (currentApplication.status === 'pending' ||
        currentApplication.status === 'reviewing')
    ) {
      throw new ConflictException('当前已有申请在审核中，请耐心等待');
    }

    const payload = this.buildPartnerApplicationPayload(dto);

    return this.prisma.$transaction(async (tx) => {
      await tx.storePartnerApplication.create({
        data: {
          storeId,
          status: 'pending',
          ...payload,
        },
      });

      await this.syncPartnerSnapshot(tx, storeId, payload, {
        status: 'pending',
        reviewedAt: null,
        joinedAt: null,
      });

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  async markPartnerApplicationReviewing(
    user: AuthenticatedUser,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);

    return this.prisma.$transaction(async (tx) => {
      const application = await this.getScopedPartnerApplicationOrThrow(
        tx,
        storeId,
        applicationId,
      );

      if (application.status !== 'pending') {
        throw new ConflictException('仅待审核申请可进入审核中');
      }

      const updateResult = await tx.storePartnerApplication.updateMany({
        where: {
          id: applicationId,
          storeId,
          status: 'pending',
        },
        data: {
          status: 'reviewing',
          reviewedAt: null,
          joinedAt: null,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('申请状态已变化，请刷新后重试');
      }

      await this.syncPartnerSnapshot(tx, storeId, application, {
        status: 'reviewing',
        reviewedAt: null,
        joinedAt: null,
      });

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  async approvePartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);

    return this.prisma.$transaction(async (tx) => {
      const application = await this.getScopedPartnerApplicationOrThrow(
        tx,
        storeId,
        applicationId,
      );

      if (
        application.status !== 'pending' &&
        application.status !== 'reviewing'
      ) {
        throw new ConflictException('当前申请状态不可执行通过操作');
      }

      const now = new Date();
      const updateResult = await tx.storePartnerApplication.updateMany({
        where: {
          id: applicationId,
          storeId,
          status: { in: ['pending', 'reviewing'] },
        },
        data: {
          status: 'approved',
          reviewedAt: now,
          joinedAt: now,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('申请状态已变化，请刷新后重试');
      }

      await this.syncPartnerSnapshot(tx, storeId, application, {
        status: 'approved',
        reviewedAt: now,
        joinedAt: now,
      });

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  async rejectPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
    dto: RejectPlatformPartnerApplicationDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const reason = dto.reason.trim();

    return this.prisma.$transaction(async (tx) => {
      const application = await this.getScopedPartnerApplicationOrThrow(
        tx,
        storeId,
        applicationId,
      );

      if (
        application.status !== 'pending' &&
        application.status !== 'reviewing'
      ) {
        throw new ConflictException('当前申请状态不可执行驳回操作');
      }

      const now = new Date();
      const updateResult = await tx.storePartnerApplication.updateMany({
        where: {
          id: applicationId,
          storeId,
          status: { in: ['pending', 'reviewing'] },
        },
        data: {
          status: 'rejected',
          reviewedAt: now,
          joinedAt: null,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('申请状态已变化，请刷新后重试');
      }

      await tx.storePartnerApplicationNote.create({
        data: {
          applicationId,
          content: reason,
        },
      });

      await this.syncPartnerSnapshot(tx, storeId, application, {
        status: 'rejected',
        reviewedAt: now,
        joinedAt: null,
      });

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  async cancelPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    await this.ensureStoreOwner(user, storeId);

    return this.prisma.$transaction(async (tx) => {
      const application = await this.getScopedPartnerApplicationOrThrow(
        tx,
        storeId,
        applicationId,
      );

      if (
        application.status !== 'pending' &&
        application.status !== 'reviewing'
      ) {
        throw new ConflictException('当前申请状态不可取消');
      }

      const deleteResult = await tx.storePartnerApplication.deleteMany({
        where: {
          id: applicationId,
          storeId,
          status: { in: ['pending', 'reviewing'] },
        },
      });

      if (deleteResult.count !== 1) {
        throw new ConflictException('申请状态已变化，请刷新后重试');
      }

      const remainingApplications = await this.findPartnerApplications(tx, storeId);
      const latestApplication = remainingApplications[0];

      if (latestApplication) {
        await this.syncPartnerSnapshot(
          tx,
          storeId,
          this.buildPartnerSnapshotFromApplication(latestApplication),
          {
            status: latestApplication.status,
            reviewedAt: latestApplication.reviewedAt,
            joinedAt: latestApplication.joinedAt,
          },
        );
      } else {
        await tx.storePartner.deleteMany({
          where: {
            storeId,
            status: { in: ['pending', 'reviewing', 'rejected'] },
          },
        });
      }

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  async addPartnerFollowUpNote(
    user: AuthenticatedUser,
    applicationId: number,
    dto: CreatePlatformPartnerFollowUpNoteDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const content = dto.content.trim();

    return this.prisma.$transaction(async (tx) => {
      await this.getScopedPartnerApplicationOrThrow(tx, storeId, applicationId);

      await tx.storePartnerApplicationNote.create({
        data: {
          applicationId,
          content,
        },
      });

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  private async ensureProfile(
    prismaExecutor: PrismaExecutor,
    storeId: number,
  ): Promise<StoreMembershipProfileRecord> {
    return prismaExecutor.storeMembershipProfile.upsert({
      where: { storeId },
      create: {
        storeId,
        totalPoints: 0,
        availablePoints: 0,
      },
      update: {},
      select: {
        id: true,
        storeId: true,
        currentPlanId: true,
        startsAt: true,
        expiresAt: true,
        totalPoints: true,
        availablePoints: true,
      },
    });
  }

  private async findPartner(
    prismaExecutor: PrismaExecutor,
    storeId: number,
  ): Promise<StorePartnerRecord | null> {
    return prismaExecutor.storePartner.findUnique({
      where: { storeId },
      select: {
        id: true,
        status: true,
        name: true,
        phone: true,
        idCard: true,
        region: true,
        intention: true,
        applyReason: true,
        paymentAccountType: true,
        paymentAccountNo: true,
        paymentAccountName: true,
        beanBalance: true,
        totalEarnedBeans: true,
        totalWithdrawnBeans: true,
        joinedAt: true,
        reviewedAt: true,
        createdAt: true,
      },
    });
  }

  private async findPromoRecords(
    prismaExecutor: PrismaExecutor,
    storeId: number,
  ): Promise<StoreMembershipPromoRecord[]> {
    return prismaExecutor.storeMembershipPromoRecord.findMany({
      where: { storeId },
      select: {
        id: true,
        inviteeName: true,
        inviteePhone: true,
        registeredAt: true,
        hasCharged: true,
        chargedAmount: true,
        chargedAt: true,
        chargedPlan: true,
        rewardBeans: true,
        settled: true,
      },
      orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async findPartnerApplications(
    prismaExecutor: PrismaExecutor,
    storeId: number,
  ): Promise<StorePartnerApplicationRecord[]> {
    return prismaExecutor.storePartnerApplication.findMany({
      where: { storeId },
      select: {
        id: true,
        storeId: true,
        status: true,
        name: true,
        phone: true,
        idCard: true,
        region: true,
        intention: true,
        applyReason: true,
        paymentAccountType: true,
        paymentAccountNo: true,
        paymentAccountName: true,
        reviewedAt: true,
        joinedAt: true,
        createdAt: true,
        followUpNotes: {
          select: {
            id: true,
            content: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async buildPartnerProfile(
    prismaExecutor: PrismaExecutor,
    storeId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const [partner, promoRecords, applications] = await Promise.all([
      this.findPartner(prismaExecutor, storeId),
      this.findPromoRecords(prismaExecutor, storeId),
      this.findPartnerApplications(prismaExecutor, storeId),
    ]);
    const currentApplication = this.buildCurrentPartnerApplication(
      applications,
      partner,
    );

    return {
      isPartner: partner?.status === 'approved',
      currentApplication,
      applications: this.buildPartnerApplications(applications, partner),
      approvedPartner: this.buildApprovedPartnerResponse(partner),
      level: this.buildPartnerLevel(partner, promoRecords),
    };
  }

  private buildProfileResponse(
    profile: StoreMembershipProfileRecord,
    partner: StorePartnerRecord | null,
  ): PlatformMembershipProfileResponseDto {
    return {
      memberInfo: this.buildMembershipInfo(profile),
      approvedPartner: this.buildApprovedPartnerResponse(partner),
    };
  }

  private buildMembershipInfo(
    profile: StoreMembershipProfileRecord,
  ): PlatformMembershipProfileResponseDto['memberInfo'] {
    const now = Date.now();
    const expiredAt = profile.expiresAt?.getTime() ?? null;
    const isActive = expiredAt !== null && expiredAt > now;

    return {
      isActive,
      planId: isActive ? profile.currentPlanId : null,
      expiredAt,
      inviteCode: this.buildInviteCode(profile.storeId),
      totalPoints: profile.totalPoints,
      availablePoints: profile.availablePoints,
    };
  }

  private buildApprovedPartnerResponse(
    partner: StorePartnerRecord | null,
  ): PlatformMembershipProfileResponseDto['approvedPartner'] {
    if (!partner || partner.status !== 'approved') {
      return null;
    }

    return {
      name: partner.name ?? '',
      phone: partner.phone ?? '',
      ...(partner.joinedAt ? { joinedAt: partner.joinedAt.getTime() } : {}),
      beanBalance: partner.beanBalance,
      totalEarnedBeans: partner.totalEarnedBeans,
      totalWithdrawnBeans: partner.totalWithdrawnBeans,
    };
  }

  private buildCurrentPartnerApplication(
    applications: StorePartnerApplicationRecord[],
    partner: StorePartnerRecord | null,
  ): PlatformMembershipPartnerApplicationDto | null {
    const latestApplication = applications[0];
    if (latestApplication) {
      return this.mapPartnerApplicationRecord(latestApplication, partner);
    }

    return this.mapLegacyPartnerApplication(partner);
  }

  private buildPartnerApplications(
    applications: StorePartnerApplicationRecord[],
    partner: StorePartnerRecord | null,
  ): PlatformMembershipPartnerApplicationDto[] {
    if (applications.length > 0) {
      return applications.map((application) =>
        this.mapPartnerApplicationRecord(application, partner),
      );
    }

    const legacyApplication = this.mapLegacyPartnerApplication(partner);
    return legacyApplication ? [legacyApplication] : [];
  }

  private mapPartnerApplicationRecord(
    application: StorePartnerApplicationRecord,
    partner: StorePartnerRecord | null,
  ): PlatformMembershipPartnerApplicationDto {
    return {
      id: String(application.id),
      name: application.name,
      phone: application.phone,
      idCard: application.idCard,
      ...(application.region.length > 0 ? { region: application.region } : {}),
      paymentMethod: application.paymentAccountType,
      paymentAccount: application.paymentAccountNo,
      intention: application.intention,
      status: application.status,
      createdAt: application.createdAt.getTime(),
      ...(application.reviewedAt
        ? { reviewedAt: application.reviewedAt.getTime() }
        : {}),
      ...(application.joinedAt ? { joinedAt: application.joinedAt.getTime() } : {}),
      ...(application.applyReason ? { applyReason: application.applyReason } : {}),
      followUpNotes: this.mapPartnerFollowUpNotes(application.followUpNotes),
      beanBalance: partner?.beanBalance ?? 0,
      totalEarnedBeans: partner?.totalEarnedBeans ?? 0,
      totalWithdrawnBeans: partner?.totalWithdrawnBeans ?? 0,
    };
  }

  private mapLegacyPartnerApplication(
    partner: StorePartnerRecord | null,
  ): PlatformMembershipPartnerApplicationDto | null {
    if (!partner) {
      return null;
    }

    return {
      id: String(partner.id),
      name: partner.name ?? '',
      phone: partner.phone ?? '',
      idCard: partner.idCard ?? '',
      ...(partner.region.length > 0 ? { region: partner.region } : {}),
      paymentMethod: partner.paymentAccountType ?? 'wechat',
      paymentAccount: partner.paymentAccountNo ?? '',
      intention: partner.intention ?? 'agent',
      status: partner.status,
      createdAt: partner.createdAt.getTime(),
      ...(partner.reviewedAt ? { reviewedAt: partner.reviewedAt.getTime() } : {}),
      ...(partner.joinedAt ? { joinedAt: partner.joinedAt.getTime() } : {}),
      ...(partner.applyReason ? { applyReason: partner.applyReason } : {}),
      followUpNotes: [],
      beanBalance: partner.beanBalance,
      totalEarnedBeans: partner.totalEarnedBeans,
      totalWithdrawnBeans: partner.totalWithdrawnBeans,
    };
  }

  private mapPartnerFollowUpNotes(
    notes: StorePartnerApplicationNoteRecord[],
  ): PlatformMembershipPartnerFollowUpNoteDto[] {
    return notes.map((note) => ({
      id: `partner-note-${note.id}`,
      content: note.content,
      createdAt: note.createdAt.getTime(),
    }));
  }

  private buildCenterStats(
    promoRecords: StoreMembershipPromoRecord[],
  ): PlatformMembershipCenterResponseDto['stats'] {
    const chargedPromos = promoRecords.filter((record) => record.hasCharged).length;
    return {
      totalPromos: promoRecords.length,
      chargedPromos,
    };
  }

  private buildOrdersOverview(
    orders: StoreMembershipOrderRecord[],
  ): PlatformMembershipOrdersOverviewDto {
    const totalAmount = orders.reduce((sum, order) => sum + order.amount, 0);
    return {
      orderCount: orders.length,
      totalAmount,
    };
  }

  private mapOrder(
    order: StoreMembershipOrderRecord,
  ): PlatformMembershipOrderResponseDto {
    return {
      id: String(order.id),
      planId: order.planId,
      planName: order.planName,
      amount: order.amount,
      pointsDeducted: order.pointsDeducted,
      pointsUsed: order.pointsUsed,
      beanDeducted: order.beanDeducted,
      beansUsed: order.beansUsed,
      status: order.status,
      createdAt: order.createdAt.getTime(),
      ...(order.paymentChannel === 'wechat' && order.paymentOrderId
        ? { wxOrderId: order.paymentOrderId }
        : {}),
    };
  }

  private buildPointsOverview(
    availablePoints: number,
    logs: StoreMembershipPointsLogRecord[],
  ): PlatformMembershipPointsLogsResponseDto['overview'] {
    const totalEarned = logs.reduce(
      (sum, log) => (log.changeAmount > 0 ? sum + log.changeAmount : sum),
      0,
    );
    const totalSpent = logs.reduce(
      (sum, log) => (log.changeAmount < 0 ? sum + Math.abs(log.changeAmount) : sum),
      0,
    );

    return {
      availablePoints,
      totalEarned,
      totalSpent,
    };
  }

  private mapPointsLog(
    log: StoreMembershipPointsLogRecord,
  ): PlatformMembershipPointsLogDto {
    return {
      id: `pts-${log.id}`,
      amount: log.changeAmount,
      type: this.resolvePointsType(log),
      source: log.source,
      description: log.description,
      createdAt: log.createdAt.getTime(),
      ...(log.expireAt ? { expireAt: log.expireAt.getTime() } : {}),
    };
  }

  private buildBeanOverview(
    partner: StorePartnerRecord | null,
  ): PlatformMembershipBeanLogsResponseDto['overview'] {
    if (!partner || partner.status !== 'approved') {
      return {
        beanBalance: 0,
        totalEarnedBeans: 0,
        totalWithdrawnBeans: 0,
      };
    }

    return {
      beanBalance: partner.beanBalance,
      totalEarnedBeans: partner.totalEarnedBeans,
      totalWithdrawnBeans: partner.totalWithdrawnBeans,
    };
  }

  private mapBeanLog(log: StorePartnerBeanLogRecord): PlatformMembershipBeanLogDto {
    return {
      id: `bean-${log.id}`,
      amount: log.changeAmount,
      type: this.resolveBeanType(log),
      source: log.source,
      description: log.description,
      ...(log.relatedPromoRecordId
        ? { relatedPromoId: `promo-${log.relatedPromoRecordId}` }
        : {}),
      ...(log.relatedPlanType ? { relatedPlanType: log.relatedPlanType } : {}),
      ...(log.relatedUser ? { relatedUser: log.relatedUser } : {}),
      createdAt: log.createdAt.getTime(),
    };
  }

  private buildPromoStats(
    promoRecords: StoreMembershipPromoRecord[],
  ): PlatformMembershipPromoStatsDto {
    const chargedPromos = promoRecords.filter((record) => record.hasCharged).length;
    const earnedBeans = promoRecords.reduce(
      (sum, record) => sum + (record.rewardBeans ?? 0),
      0,
    );
    return {
      totalPromos: promoRecords.length,
      chargedPromos,
      promoRate:
        promoRecords.length > 0
          ? Math.round((chargedPromos / promoRecords.length) * 100)
          : 0,
      earnedBeans,
    };
  }

  private buildPromoStatsByPeriod(
    promoRecords: StoreMembershipPromoRecord[],
  ): PlatformMembershipPromoCenterResponseDto['statsByPeriod'] {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const yearStart = new Date(now);
    yearStart.setMonth(0, 1);
    yearStart.setHours(0, 0, 0, 0);

    return {
      all: this.buildPromoStats(promoRecords),
      today: this.buildPromoStatsForPeriod(promoRecords, todayStart),
      month: this.buildPromoStatsForPeriod(promoRecords, monthStart),
      year: this.buildPromoStatsForPeriod(promoRecords, yearStart),
    };
  }

  private buildPromoStatsForPeriod(
    promoRecords: StoreMembershipPromoRecord[],
    startAt: Date,
  ): PlatformMembershipPromoStatsDto {
    const startTimestamp = startAt.getTime();
    const filteredRecords = promoRecords.filter(
      (record) => record.registeredAt.getTime() >= startTimestamp,
    );

    return this.buildPromoStats(filteredRecords);
  }

  private mapPromoRecord(
    record: StoreMembershipPromoRecord,
  ): PlatformMembershipPromoRecordDto {
    return {
      id: `promo-${record.id}`,
      inviteeName: record.inviteeName,
      inviteePhone: record.inviteePhone,
      registeredAt: record.registeredAt.getTime(),
      hasCharged: record.hasCharged,
      ...(record.chargedAmount !== null ? { chargedAmount: record.chargedAmount } : {}),
      ...(record.chargedAt ? { chargedAt: record.chargedAt.getTime() } : {}),
      ...(record.chargedPlan ? { chargedPlan: record.chargedPlan } : {}),
      ...(record.rewardBeans !== null ? { rewardBeans: record.rewardBeans } : {}),
      ...(record.hasCharged ? { settled: record.settled } : {}),
    };
  }

  private buildPartnerLevel(
    partner: StorePartnerRecord | null,
    promoRecords: StoreMembershipPromoRecord[],
  ): PlatformMembershipPartnerLevelDto {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartTs = monthStart.getTime();
    const monthChargedCount = promoRecords.filter(
      (record) =>
        record.hasCharged &&
        record.chargedAt !== null &&
        record.chargedAt.getTime() >= monthStartTs,
    ).length;

    if (!partner || partner.status !== 'approved') {
      return {
        partnerLevel: null,
        monthChargedCount,
        monthCountToNextLevel: null,
      };
    }

    const partnerLevel = this.resolvePartnerLevel(monthChargedCount);

    return {
      partnerLevel,
      monthChargedCount,
      monthCountToNextLevel:
        partnerLevel === 'legend'
          ? null
          : partnerLevel === 'elite'
            ? Math.max(0, 30 - monthChargedCount)
            : Math.max(0, 10 - monthChargedCount),
    };
  }

  private buildPartnerApplicationPayload(
    dto: ApplyPlatformPartnerDto,
  ): PartnerSnapshotPayload {
    return {
      name: dto.name.trim(),
      phone: dto.phone.trim(),
      idCard: dto.idCard.trim().toUpperCase(),
      region: dto.region?.filter((value) => value.trim() !== '') ?? [],
      intention: dto.intention,
      applyReason: dto.applyReason?.trim() || null,
      paymentAccountType: dto.paymentMethod,
      paymentAccountNo: dto.paymentAccount.trim(),
      paymentAccountName: dto.name.trim(),
    };
  }

  private buildPartnerSnapshotFromApplication(
    application: StorePartnerApplicationRecord,
  ): PartnerSnapshotPayload {
    return {
      name: application.name,
      phone: application.phone,
      idCard: application.idCard,
      region: application.region,
      intention: application.intention,
      applyReason: application.applyReason,
      paymentAccountType: application.paymentAccountType,
      paymentAccountNo: application.paymentAccountNo,
      paymentAccountName: application.paymentAccountName,
    };
  }

  private async syncPartnerSnapshot(
    prismaExecutor: PrismaExecutor,
    storeId: number,
    payload: PartnerSnapshotPayload,
    statusSnapshot: {
      status: PartnerStatusValue;
      reviewedAt: Date | null;
      joinedAt: Date | null;
    },
  ): Promise<void> {
    await prismaExecutor.storePartner.upsert({
      where: { storeId },
      create: {
        storeId,
        ...payload,
        status: statusSnapshot.status,
        reviewedAt: statusSnapshot.reviewedAt,
        joinedAt: statusSnapshot.joinedAt,
      },
      update: {
        ...payload,
        status: statusSnapshot.status,
        reviewedAt: statusSnapshot.reviewedAt,
        joinedAt: statusSnapshot.joinedAt,
      },
    });
  }

  private async getScopedPartnerApplicationOrThrow(
    prismaExecutor: PrismaExecutor,
    storeId: number,
    applicationId: number,
  ): Promise<StorePartnerApplicationRecord> {
    const application = await prismaExecutor.storePartnerApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        storeId: true,
        status: true,
        name: true,
        phone: true,
        idCard: true,
        region: true,
        intention: true,
        applyReason: true,
        paymentAccountType: true,
        paymentAccountNo: true,
        paymentAccountName: true,
        reviewedAt: true,
        joinedAt: true,
        createdAt: true,
        followUpNotes: {
          select: {
            id: true,
            content: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        },
      },
    });

    if (!application || application.storeId !== storeId) {
      throw new ForbiddenException('无权操作该合伙人申请');
    }

    return application;
  }

  private resolvePartnerLevel(
    monthChargedCount: number,
  ): PartnerLevelValue {
    if (monthChargedCount >= 30) {
      return 'legend';
    }

    if (monthChargedCount >= 10) {
      return 'elite';
    }

    return 'star';
  }

  private resolvePointsType(
    log: StoreMembershipPointsLogRecord,
  ): PointsTypeValue {
    if (log.source === 'expire') {
      return 'expire';
    }

    return log.changeAmount >= 0 ? 'earn' : 'spend';
  }

  private resolveBeanType(log: StorePartnerBeanLogRecord): BeanTypeValue {
    if (log.source === 'withdrawal') {
      return 'withdraw';
    }

    return log.changeAmount >= 0 ? 'earn' : 'spend';
  }

  private requirePlan(planId: PlatformMembershipPlanId): MembershipPlanConfig {
    const matchedPlan = PLAN_CATALOG.find((plan) => plan.id === planId);
    if (!matchedPlan) {
      throw new ConflictException('套餐不存在');
    }

    return matchedPlan;
  }

  private getCurrentStoreIdOrThrow(user: AuthenticatedUser): number {
    const storeId = user.currentMembership?.storeId;
    if (!storeId) {
      throw new ForbiddenException('当前账号未绑定门店，暂无法使用会员中心');
    }

    return storeId;
  }

  private async ensureStoreOwner(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<void> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, ownerId: user.id },
      select: { id: true },
    });

    if (!store) {
      throw new ForbiddenException('仅老板可操作会员中心老板能力');
    }
  }

  private buildInviteCode(storeId: number): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let seed = storeId * 1103515245 + 12345;
    let inviteCode = '';

    for (let index = 0; index < 6; index += 1) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      inviteCode += alphabet[seed % alphabet.length];
    }

    return inviteCode;
  }

  private calcRemainingDays(expiresAt: Date | null): number {
    if (!expiresAt) {
      return 0;
    }

    const diff = expiresAt.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / DAY_MS));
  }

  private generateWechatOrderId(storeId: number, now: Date): string {
    return `WX${storeId}${now.getTime()}`;
  }

  private requireApprovedPartnerOrNull(
    partner: StorePartnerRecord | null,
  ): StorePartnerRecord | null {
    if (!partner || partner.status !== 'approved') {
      return null;
    }

    return partner;
  }

  private calcMemberPlanPayment(params: {
    planPrice: number;
    requestedPoints: number;
    availablePoints: number;
    requestedBeans: number;
    availableBeans: number;
    pointsRate: number;
    pointsDeductLimitRate: number;
    beanDeductRate: number;
    beanDeductLimitRate?: number;
  }): PaymentCalculationResult {
    const {
      planPrice,
      requestedPoints,
      availablePoints,
      requestedBeans,
      availableBeans,
      pointsRate,
      pointsDeductLimitRate,
      beanDeductRate,
      beanDeductLimitRate = 0.5,
    } = params;
    const planPriceDecimal = new Decimal(planPrice);
    const zero = new Decimal(0);

    const maxBeanDeductAmount = planPriceDecimal
      .mul(beanDeductLimitRate)
      .floor();
    const beanDeductAmount = Decimal.max(
      zero,
      Decimal.min(
        new Decimal(requestedBeans).mul(beanDeductRate),
        maxBeanDeductAmount,
        new Decimal(availableBeans).mul(beanDeductRate),
      ),
    );
    const actualBeansUsed = beanDeductAmount.div(beanDeductRate).floor();

    const priceAfterBeans = Decimal.max(
      zero,
      planPriceDecimal.minus(beanDeductAmount),
    );
    const maxPointsDeductAmount = priceAfterBeans
      .mul(pointsDeductLimitRate)
      .floor();
    const requestedPointsDeductAmount = new Decimal(requestedPoints)
      .div(pointsRate)
      .floor()
      .mul(100);
    const availablePointsDeductAmount = new Decimal(availablePoints)
      .div(pointsRate)
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
    const actualPointsUsed = pointsDeductAmount.div(100).mul(pointsRate);
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
