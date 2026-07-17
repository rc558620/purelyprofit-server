import { ConflictException } from '@nestjs/common';
import { PartnerWithdrawalStatus, Prisma } from '@prisma/client';
import type { ApplyWithdrawalDto } from './dto/apply-withdrawal.dto';
import {
  type WithdrawalRecordSnapshot,
  withdrawalRecordSelect,
} from './withdrawals.mapper';
import { calcWithdrawalAmounts } from './withdrawals-shared.service';

// ─── Types ───────────────────────────────────────────────────────────

export type PrismaTransactionExecutor = Prisma.TransactionClient;

export type WithdrawalStatusUpdateInput = {
  withdrawalId: number;
  storeId: number;
  currentStatus: PartnerWithdrawalStatus;
  nextStatus: PartnerWithdrawalStatus;
  reviewedAt?: Date | null;
  paidAt?: Date | null;
  rejectReason?: string | null;
};

export type ApplyWithdrawalTransactionInput = {
  storeId: number;
  partnerId: number;
  operatorStaffId: number | null;
  dto: ApplyWithdrawalDto;
  accountNo: string;
  accountName: string;
};

// ─── Constants ───────────────────────────────────────────────────────

export const WITHDRAWALS_OVERVIEW_CACHE_TTL_SECONDS = 90;
export const WITHDRAWALS_OVERVIEW_REFRESH_AFTER_MS = 20_000;
export const WITHDRAWALS_LIST_CACHE_TTL_SECONDS = 45;
export const WITHDRAWALS_LIST_REFRESH_AFTER_MS = 15_000;
export const APPLY_DUPLICATE_WINDOW_MS = 5_000;

// ─── Transaction helpers ─────────────────────────────────────────────

export async function createWithdrawalApplication(
  tx: PrismaTransactionExecutor,
  input: ApplyWithdrawalTransactionInput,
): Promise<WithdrawalRecordSnapshot> {
  const { storeId, partnerId, operatorStaffId, dto, accountNo, accountName } =
    input;
  const partnerUpdateResult = await tx.storePartner.updateMany({
    where: {
      id: partnerId,
      status: 'approved',
      beanBalance: { gte: dto.beanAmount },
    },
    data: {
      beanBalance: { decrement: dto.beanAmount },
      totalWithdrawnBeans: { increment: dto.beanAmount },
      paymentAccountType: dto.accountType,
      paymentAccountNo: accountNo,
      paymentAccountName: accountName,
    },
  });

  if (partnerUpdateResult.count !== 1) {
    throw new ConflictException('纯利豆余额不足，无法发起提现申请');
  }

  const createdRecord = await tx.partnerWithdrawal.create({
    data: {
      storeId,
      partnerId,
      operatorStaffId,
      beanAmount: dto.beanAmount,
      rmbAmount: calcWithdrawalAmounts(dto.beanAmount).rmbAmount,
      accountType: dto.accountType,
      accountNo,
      accountName,
      status: PartnerWithdrawalStatus.pending,
    },
    select: withdrawalRecordSelect,
  });

  await tx.storePartnerBeanLog.create({
    data: {
      storeId,
      partnerId,
      source: 'withdrawal',
      changeAmount: -dto.beanAmount,
      description: `提现申请 · ${dto.beanAmount} 豆`,
    },
  });

  return createdRecord;
}

export async function updateWithdrawalStatusOrThrow(
  tx: PrismaTransactionExecutor,
  input: WithdrawalStatusUpdateInput,
): Promise<void> {
  const { withdrawalId, storeId, currentStatus, nextStatus } = input;
  const updateResult = await tx.partnerWithdrawal.updateMany({
    where: {
      id: withdrawalId,
      storeId,
      status: currentStatus,
    },
    data: {
      status: nextStatus,
      ...(input.reviewedAt !== undefined
        ? { reviewedAt: input.reviewedAt }
        : {}),
      ...(input.paidAt !== undefined ? { paidAt: input.paidAt } : {}),
      ...(input.rejectReason !== undefined
        ? { rejectReason: input.rejectReason }
        : {}),
    },
  });

  if (updateResult.count !== 1) {
    throw new ConflictException('提现申请状态已变化，请刷新后重试');
  }
}

export async function refundRejectedWithdrawalOrThrow(
  tx: PrismaTransactionExecutor,
  record: WithdrawalRecordSnapshot,
): Promise<void> {
  const partnerUpdateResult = await tx.storePartner.updateMany({
    where: {
      id: record.partnerId,
      storeId: record.storeId,
      totalWithdrawnBeans: { gte: record.beanAmount },
    },
    data: {
      beanBalance: { increment: record.beanAmount },
      totalWithdrawnBeans: { decrement: record.beanAmount },
    },
  });

  if (partnerUpdateResult.count !== 1) {
    throw new ConflictException('合伙人余额更新失败，请稍后重试');
  }

  await tx.storePartnerBeanLog.create({
    data: {
      storeId: record.storeId,
      partnerId: record.partnerId,
      source: 'admin_adjust',
      changeAmount: record.beanAmount,
      description: `提现退回 · ${record.beanAmount} 豆已退回`,
    },
  });
}

export function assertWithdrawalStatus(
  actualStatus: PartnerWithdrawalStatus,
  expectedStatus: PartnerWithdrawalStatus,
  errorMessage: string,
): void {
  if (actualStatus !== expectedStatus) {
    throw new ConflictException(errorMessage);
  }
}
