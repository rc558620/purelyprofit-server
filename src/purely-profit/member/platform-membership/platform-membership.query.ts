import { ConflictException, ForbiddenException } from '@nestjs/common';
import { mapConcurrent } from '../../../shared/concurrency.utils';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import {
  DEFAULT_MEMBERSHIP_PLAN_SETTINGS,
  PLATFORM_MEMBERSHIP_PLAN_ORDER,
} from './platform-membership.constants';
import { toPlanConfig } from './membership-plan-resolver';
import type {
  MembershipPlanConfig,
  MembershipPlanSettingIdValue,
  MembershipPlanSettingRecord,
  PartnerSnapshotPayload,
  PrismaExecutor,
  StoreMembershipProfileRecord,
  StoreMembershipOrderRecord,
  StoreMembershipPromoRecord,
  StorePartnerApplicationRecord,
  StorePartnerRecord,
} from './platform-membership.types';

export async function ensureMembershipProfile(
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

const storePartnerSelect = {
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
  store: {
    select: {
      owner: {
        select: {
          avatar: true,
        },
      },
    },
  },
} as const;

export async function findStorePartners(
  prismaExecutor: PrismaExecutor,
  storeId: number,
): Promise<StorePartnerRecord[]> {
  return prismaExecutor.storePartner.findMany({
    where: { storeId, deletedAt: null, status: 'approved' },
    select: storePartnerSelect,
    orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
  });
}

export async function findStorePartnerByApplicant(
  prismaExecutor: PrismaExecutor,
  storeId: number,
  applicant: Pick<PartnerSnapshotPayload, 'idCard' | 'phone'>,
): Promise<StorePartnerRecord | null> {
  return prismaExecutor.storePartner.findFirst({
    where: {
      storeId,
      deletedAt: null,
      OR: [{ idCard: applicant.idCard }, { phone: applicant.phone }],
    },
    select: storePartnerSelect,
    orderBy: [
      { status: 'desc' },
      { reviewedAt: 'desc' },
      { joinedAt: 'desc' },
      { id: 'desc' },
    ],
  });
}

export async function findStoreMembershipPromoRecords(
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

export async function findPaidStoreMembershipOrders(
  prismaExecutor: PrismaExecutor,
  storeId: number,
): Promise<StoreMembershipOrderRecord[]> {
  return prismaExecutor.storeMembershipOrder.findMany({
    where: { storeId, status: 'paid' },
    select: {
      id: true,
      planId: true,
      planName: true,
      amount: true,
      pointsUsed: true,
      beansUsed: true,
      status: true,
      paymentChannel: true,
      paymentOrderId: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function findStorePartnerApplications(
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

export async function getScopedStorePartnerApplicationOrThrow(
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

export async function loadPlanCatalog(
  prismaExecutor: PrismaExecutor,
): Promise<MembershipPlanConfig[]> {
  const settings = await loadMembershipPlanSettings(prismaExecutor);
  return PLATFORM_MEMBERSHIP_PLAN_ORDER.map((planId) =>
    toPlanConfig(settings[planId]),
  );
}

export async function loadMembershipPlanSettings(
  prismaExecutor: PrismaExecutor,
): Promise<Record<MembershipPlanSettingIdValue, MembershipPlanSettingRecord>> {
  const rows = await prismaExecutor.membershipPlanSetting.findMany({
    select: {
      planId: true,
      planName: true,
      price: true,
      originalPrice: true,
      durationMonths: true,
      validDays: true,
      updatedAt: true,
    },
    orderBy: {
      id: 'asc',
    },
  });

  const byPlanId = Object.create(null) as Record<
    MembershipPlanSettingIdValue,
    MembershipPlanSettingRecord
  >;

  for (const row of rows) {
    byPlanId[row.planId as MembershipPlanSettingIdValue] = {
      planId: row.planId as MembershipPlanSettingIdValue,
      planName: row.planName,
      price: row.price,
      originalPrice: row.originalPrice,
      durationMonths: row.durationMonths,
      validDays: row.validDays,
      updatedAt: row.updatedAt,
    };
  }

  const missingPlanIds = (
    Object.keys(
      DEFAULT_MEMBERSHIP_PLAN_SETTINGS,
    ) as MembershipPlanSettingIdValue[]
  ).filter((planId) => byPlanId[planId] === undefined);

  if (missingPlanIds.length === 0) {
    return byPlanId;
  }

  const now = new Date();
  // 并行 upsert 所有缺失的套餐设置，替代逐条串行执行（通常仅首次调用时触发）
  // 使用并发控制避免打满数据库连接池（缺失项通常 ≤ 4 项）
  const createdEntries = await mapConcurrent(
    missingPlanIds,
    async (planId) => {
      const defaultSetting = DEFAULT_MEMBERSHIP_PLAN_SETTINGS[planId];
      const created = await prismaExecutor.membershipPlanSetting.upsert({
        where: { planId },
        create: {
          planId: defaultSetting.planId,
          planName: defaultSetting.planName,
          price: defaultSetting.price,
          originalPrice: defaultSetting.originalPrice,
          durationMonths: defaultSetting.durationMonths,
          validDays: defaultSetting.validDays,
        },
        update: {},
        select: {
          planId: true,
          planName: true,
          price: true,
          originalPrice: true,
          durationMonths: true,
          validDays: true,
          updatedAt: true,
        },
      });
      return created;
    },
  );

  for (const created of createdEntries) {
    const planId = created.planId as MembershipPlanSettingIdValue;
    byPlanId[planId] = {
      planId,
      planName: created.planName,
      price: created.price,
      originalPrice: created.originalPrice,
      durationMonths: created.durationMonths,
      validDays: created.validDays,
      updatedAt: created.updatedAt ?? now,
    };
  }

  return byPlanId;
}

export async function requirePlan(
  prismaExecutor: PrismaExecutor,
  planId: PlatformMembershipPlanId,
): Promise<MembershipPlanConfig> {
  const plans = await loadPlanCatalog(prismaExecutor);
  const matchedPlan = plans.find((plan) => plan.id === planId);
  if (!matchedPlan) {
    throw new ConflictException('套餐不存在');
  }

  return matchedPlan;
}

export async function ensurePlatformMembershipStoreOwner(
  prisma: PrismaService,
  userId: number,
  storeId: number,
): Promise<void> {
  const store = await prisma.store.findFirst({
    where: { id: storeId, ownerId: userId },
    select: { id: true },
  });

  if (!store) {
    throw new ForbiddenException('仅老板可操作会员中心老板能力');
  }
}
