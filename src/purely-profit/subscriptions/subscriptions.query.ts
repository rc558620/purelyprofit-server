import {
  Prisma,
  PrismaClient,
  StaffStatus,
  StoreSubscriptionStatus,
  SubscriptionPlanCode,
} from '@prisma/client';
import type { PlanSnapshot } from './subscriptions.types';

export type SubscriptionQueryExecutor = Prisma.TransactionClient | PrismaClient;

export async function findStoreSeatCapacityRecord(
  prisma: SubscriptionQueryExecutor,
  storeId: number,
): Promise<{ id: number; maxAccountSeats: number } | null> {
  return prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, maxAccountSeats: true },
  });
}

export async function countActiveStoreSeats(
  prisma: SubscriptionQueryExecutor,
  storeId: number,
): Promise<number> {
  return prisma.staff.count({
    where: {
      storeId,
      isSeatActive: true,
      status: StaffStatus.ACTIVE,
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
  const status = params.targetStatus ?? StoreSubscriptionStatus.ACTIVE;

  await transaction.storeSubscription.upsert({
    where: { storeId: params.storeId },
    create: {
      storeId: params.storeId,
      planCode: params.planCode,
      planName: params.planSnapshot.planName,
      status,
      maxAccountSeats: params.planSnapshot.maxAccountSeats,
      expiresAt: params.expiresAt,
    },
    update: {
      planCode: params.planCode,
      planName: params.planSnapshot.planName,
      status,
      maxAccountSeats: params.planSnapshot.maxAccountSeats,
      expiresAt: params.expiresAt,
    },
  });
}

export async function updateStoreSeatCapacity(
  transaction: Prisma.TransactionClient,
  params: { storeId: number; maxAccountSeats: number },
): Promise<void> {
  await transaction.store.update({
    where: { id: params.storeId },
    data: { maxAccountSeats: params.maxAccountSeats },
  });
}
