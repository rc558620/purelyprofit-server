import { Prisma, type PartnerWithdrawal } from '@prisma/client';
import type { WithdrawalRecordResponseDto } from './dto/withdrawal-response.dto';

export const withdrawalRecordSelect = {
  id: true,
  storeId: true,
  partnerId: true,
  operatorStaffId: true,
  beanAmount: true,
  rmbAmount: true,
  accountType: true,
  accountNo: true,
  accountName: true,
  status: true,
  appliedAt: true,
  reviewedAt: true,
  paidAt: true,
  rejectReason: true,
} satisfies Prisma.PartnerWithdrawalSelect;

export type WithdrawalRecordSnapshot = Prisma.PartnerWithdrawalGetPayload<{
  select: typeof withdrawalRecordSelect;
}>;

export function mapWithdrawalRecord(
  record: Pick<
    PartnerWithdrawal,
    | 'id'
    | 'beanAmount'
    | 'rmbAmount'
    | 'accountType'
    | 'accountNo'
    | 'accountName'
    | 'status'
    | 'appliedAt'
    | 'reviewedAt'
    | 'paidAt'
    | 'rejectReason'
  >,
): WithdrawalRecordResponseDto {
  // 金额取申请时落库的快照，禁止按当前费率重算历史记录；
  // 当前无手续费，实到金额与落库金额一致，未来扣费口径由 preview/apply 统一产出。
  const response: WithdrawalRecordResponseDto = {
    id: String(record.id),
    beanAmount: record.beanAmount,
    rmbAmount: record.rmbAmount,
    netRmbAmount: record.rmbAmount,
    accountType: record.accountType,
    accountNo: record.accountNo,
    accountName: record.accountName,
    status: record.status,
    appliedAt: record.appliedAt.getTime(),
  };

  if (record.reviewedAt) {
    response.reviewedAt = record.reviewedAt.getTime();
  }

  if (record.paidAt) {
    response.paidAt = record.paidAt.getTime();
  }

  if (record.rejectReason) {
    response.rejectReason = record.rejectReason;
  }

  return response;
}
