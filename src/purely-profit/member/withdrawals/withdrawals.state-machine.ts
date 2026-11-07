// 提现状态机：profit 与 pulse 两端唯一的流转规则与写库数据构造入口
import { ConflictException } from '@nestjs/common';
import { PartnerWithdrawalStatus, Prisma } from '@prisma/client';

export type WithdrawalAction = 'approve' | 'reject' | 'pay';

export interface WithdrawalTransitionRule {
  /** 允许执行该动作的前置状态 */
  readonly from: readonly PartnerWithdrawalStatus[];
  readonly to: PartnerWithdrawalStatus;
  readonly message: string;
}

/**
 * 统一状态机。
 *
 * pay 允许从 pending 直接进入 paid，用于兼容 pulse 端「一键确认打款」；
 * profit 端同样遵守该规则，避免两端各自维护一套状态判断后互相打断。
 * paid / rejected 为终态，任何动作都不可再流转。
 */
export const WITHDRAWAL_TRANSITIONS: Record<
  WithdrawalAction,
  WithdrawalTransitionRule
> = {
  approve: {
    from: [PartnerWithdrawalStatus.pending],
    to: PartnerWithdrawalStatus.approved,
    message: '仅审核中的提现申请可执行通过操作',
  },
  reject: {
    from: [PartnerWithdrawalStatus.pending, PartnerWithdrawalStatus.approved],
    to: PartnerWithdrawalStatus.rejected,
    message: '仅处理中的提现申请可执行拒绝操作',
  },
  pay: {
    from: [PartnerWithdrawalStatus.pending, PartnerWithdrawalStatus.approved],
    to: PartnerWithdrawalStatus.paid,
    message: '仅处理中的提现申请可确认打款',
  },
};

export function assertWithdrawalTransition(
  action: WithdrawalAction,
  currentStatus: PartnerWithdrawalStatus,
): WithdrawalTransitionRule {
  const rule = WITHDRAWAL_TRANSITIONS[action];
  if (!rule.from.includes(currentStatus)) {
    throw new ConflictException(rule.message);
  }
  return rule;
}

export interface WithdrawalTransitionInput {
  action: WithdrawalAction;
  now: Date;
  staffId: number | null;
  rejectReason?: string;
}

/** 构造状态流转的写库数据；审计字段由统一入口填充，禁止各端手写 */
export function buildWithdrawalTransitionData(
  input: WithdrawalTransitionInput,
): Prisma.PartnerWithdrawalUpdateManyMutationInput {
  const { action, now, staffId, rejectReason } = input;
  const rule = WITHDRAWAL_TRANSITIONS[action];

  switch (action) {
    case 'approve':
      return {
        status: rule.to,
        reviewedAt: now,
        reviewedByStaffId: staffId,
        rejectReason: null,
      };
    case 'reject':
      return {
        status: rule.to,
        reviewedAt: now,
        reviewedByStaffId: staffId,
        paidAt: null,
        rejectReason: rejectReason ?? null,
      };
    case 'pay':
      return {
        status: rule.to,
        paidAt: now,
        paidByStaffId: staffId,
        rejectReason: null,
      };
    default:
      throw new ConflictException('不支持的提现状态流转动作');
  }
}

/**
 * 带前置状态条件的原子更新：影响行数用于判断并发抢占。
 * profit 与 pulse 共用同一实现，避免两端各自写一套 updateMany 条件。
 */
export async function updateWithdrawalStatusOrThrow(
  tx: Prisma.TransactionClient,
  input: {
    withdrawalId: number;
    storeId: number;
    from: readonly PartnerWithdrawalStatus[];
    data: Prisma.PartnerWithdrawalUpdateManyMutationInput;
  },
): Promise<void> {
  const result = await tx.partnerWithdrawal.updateMany({
    where: {
      id: input.withdrawalId,
      storeId: input.storeId,
      status: { in: [...input.from] },
    },
    data: input.data,
  });

  if (result.count !== 1) {
    throw new ConflictException('提现申请状态已变化，请刷新后重试');
  }
}

/** 资金动作结构化审计日志载荷 */
export function buildWithdrawalAuditLog(input: {
  action: WithdrawalAction;
  withdrawalId: number;
  storeId: number;
  from: PartnerWithdrawalStatus;
  staffId: number | null;
}): string {
  return JSON.stringify({
    event: 'partner_withdrawal_transition',
    withdrawalId: input.withdrawalId,
    storeId: input.storeId,
    action: input.action,
    from: input.from,
    to: WITHDRAWAL_TRANSITIONS[input.action].to,
    operatorStaffId: input.staffId,
  });
}
