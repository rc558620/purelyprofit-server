import {
  Prisma,
  PrismaClient,
  StaffStatus,
  StoreSubscriptionStatus,
  SubscriptionPlanCode,
} from '@prisma/client';
import type { PlanSnapshot } from './subscriptions.types';

export type SubscriptionQueryExecutor = Prisma.TransactionClient | PrismaClient;

/**
 * 读取门店席位上限。
 * ✅ 事实源：StoreMembershipProfile.subAccountQuota（spec 0.6）
 */
export async function findStoreSeatCapacityRecord(
  prisma: SubscriptionQueryExecutor,
  storeId: number,
): Promise<{ id: number; seatQuota: number } | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true },
  });
  if (!store) return null;

  const profile = await prisma.storeMembershipProfile.findUnique({
    where: { storeId },
    select: { subAccountQuota: true },
  });

  // subAccountQuota 默认值：若 profile 未创建（新门店尚未初始化），回退到 1（STARTER 默认值）
  return {
    id: store.id,
    seatQuota: profile?.subAccountQuota ?? 1,
  };
}

export async function countActiveStoreSeats(
  prisma: SubscriptionQueryExecutor,
  storeId: number,
): Promise<number> {
  return prisma.staff.count({
    where: {
      storeId,
      isSeatActive: true,
      status: StaffStatus.active,
      isActive: true,
    },
  });
}

export async function findStoreSubscriptionRecord(
  prisma: SubscriptionQueryExecutor,
  storeId: number,
) {
  return prisma.storeSubscription.findUnique({
    where: { storeId },
  });
}

export async function upsertStoreSubscriptionRecord(
  transaction: Prisma.TransactionClient,
  params: {
    storeId: number;
    planCode: SubscriptionPlanCode;
    planSnapshot: PlanSnapshot;
    expiresAt: Date | null;
    /** 订阅目标状态，默认 ACTIVE；续费/重新激活时由调用方显式传入 */
    targetStatus?: StoreSubscriptionStatus;
  },
): Promise<void> {
  const status = params.targetStatus ?? StoreSubscriptionStatus.active;

  await transaction.storeSubscription.upsert({
    where: { storeId: params.storeId },
    create: {
      storeId: params.storeId,
      planCode: params.planCode,
      planName: params.planSnapshot.planName,
      maxAccountSeats: params.planSnapshot.maxAccountSeats,
      status,
      expiresAt: params.expiresAt,
    },
    update: {
      planCode: params.planCode,
      planName: params.planSnapshot.planName,
      maxAccountSeats: params.planSnapshot.maxAccountSeats,
      status,
      expiresAt: params.expiresAt,
    },
  });
}

/**
 * 同步门店席位上限到 StoreMembershipProfile.subAccountQuota。
 * ✅ 事实源：StoreMembershipProfile.subAccountQuota（spec 0.6）
 */
export async function updateStoreSeatCapacity(
  transaction: Prisma.TransactionClient,
  params: { storeId: number; seatQuota: number },
): Promise<void> {
  await transaction.storeMembershipProfile.upsert({
    where: { storeId: params.storeId },
    create: {
      storeId: params.storeId,
      subAccountQuota: params.seatQuota,
      totalPoints: 0,
      availablePoints: 0,
    },
    update: {
      subAccountQuota: params.seatQuota,
    },
  });
}
