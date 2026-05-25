import {
  FinanceAccountStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { FinanceAccountRecordWithAmount } from './finance.types';

export async function queryAccountRecords(
  prisma: PrismaService,
  storeId: number,
): Promise<FinanceAccountRecordWithAmount[]> {
  return prisma.financeAccountRecord.findMany({
    where: { storeId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
}

export async function createAccountRecordEntity(
  prisma: PrismaService,
  data: Prisma.FinanceAccountRecordCreateArgs['data'],
): Promise<FinanceAccountRecordWithAmount> {
  return prisma.financeAccountRecord.create({ data });
}

export async function findAccountRecord(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<FinanceAccountRecordWithAmount | null> {
  return prisma.financeAccountRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
  });
}

export async function findAccountRecordId(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<{ id: number } | null> {
  return prisma.financeAccountRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    select: { id: true },
  });
}

export async function updateAccountRecordSettlement(
  prisma: PrismaService,
  params: {
    recordId: number;
    paidAmount: Prisma.Decimal;
    remaining: Prisma.Decimal;
    status: FinanceAccountStatus;
  },
): Promise<FinanceAccountRecordWithAmount> {
  return prisma.financeAccountRecord.update({
    where: { id: params.recordId },
    data: {
      paidAmount: params.paidAmount,
      remaining: params.remaining,
      status: params.status,
    },
  });
}

export async function deleteAccountRecordEntity(
  prisma: PrismaService,
  recordId: number,
): Promise<void> {
  await prisma.financeAccountRecord.delete({
    where: { id: recordId },
  });
}
