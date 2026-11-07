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

export type ApplyWithdrawalTransactionInput = {
  storeId: number;
  partnerId: number;
  operatorStaffId: number | null;
  /** 幂等键：客户端 Idempotency-Key 或服务端生成，落库唯一约束兜底 */
  idempotencyKey: string;
  dto: ApplyWithdrawalDto;
  accountNo: string;
  accountName: string;
};

// ─── Constants ───────────────────────────────────────────────────────

export const WITHDRAWALS_LIST_CACHE_TTL_SECONDS = 45;
export const WITHDRAWALS_LIST_REFRESH_AFTER_MS = 15_000;
/** 提现申请分布式锁的持有上限，需覆盖一次事务写入 + 汇总回查 */
export const APPLY_LOCK_TTL_SECONDS = 10;
export const APPLY_LOCK_RETRY_TIMES = 2;
export const APPLY_LOCK_RETRY_DELAY_MS = 50;
/** 客户端幂等键最大长度，与 schema 的 VarChar(128) 对齐 */
export const APPLY_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

// ─── Transaction helpers ───────────────────────────────────────────

/**
 * 事务内幂等重放。
 *
 * 不再使用「5 秒内同金额」的启发式查重：它既挡不住并发穿透，又会误拒
 * 合法的二次申请。幂等由客户端 Idempotency-Key + 数据库唯一约束保证。
 */
export async function findIdempotentWithdrawal(
  tx: PrismaTransactionExecutor,
  input: { storeId: number; idempotencyKey: string },
): Promise<WithdrawalRecordSnapshot | null> {
  return tx.partnerWithdrawal.findFirst({
    where: {
      storeId: input.storeId,
      idempotencyKey: input.idempotencyKey,
    },
    select: withdrawalRecordSelect,
  });
}

export async function createWithdrawalApplication(
  tx: PrismaTransactionExecutor,
  input: ApplyWithdrawalTransactionInput,
): Promise<WithdrawalRecordSnapshot> {
  const {
    storeId,
    partnerId,
    operatorStaffId,
    idempotencyKey,
    dto,
    accountNo,
    accountName,
  } = input;
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
      idempotencyKey,
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
