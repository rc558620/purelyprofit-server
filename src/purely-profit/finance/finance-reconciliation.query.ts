import { type FinanceReconciliationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { FinanceReconciliationRecordWithItems } from './finance.types';

const FINANCE_RECONCILIATION_RECORD_INCLUDE = {
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.FinanceReconciliationRecordInclude;

export async function queryReconciliationRecords(
  prisma: PrismaService,
  storeId: number,
): Promise<FinanceReconciliationRecordWithItems[]> {
  return prisma.financeReconciliationRecord.findMany({
    where: { storeId },
    include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
}

export async function createReconciliationRecordEntity(
  prisma: PrismaService,
  data: Prisma.FinanceReconciliationRecordCreateArgs['data'],
): Promise<FinanceReconciliationRecordWithItems> {
  return prisma.financeReconciliationRecord.create({
    data,
    include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
  });
}

export async function findReconciliationRecord(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<FinanceReconciliationRecordWithItems | null> {
  return prisma.financeReconciliationRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
  });
}

export async function findReconciliationRecordId(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<{ id: number } | null> {
  return prisma.financeReconciliationRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    select: { id: true },
  });
}

export async function updateReconciliationConfirmation(
  prisma: PrismaService,
  params: {
    recordId: number;
    status: FinanceReconciliationStatus;
    adjustNote: string | null;
  },
): Promise<FinanceReconciliationRecordWithItems> {
  return prisma.financeReconciliationRecord.update({
    where: { id: params.recordId },
    data: {
      status: params.status,
      adjustNote: params.adjustNote,
    },
    include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
  });
}

export async function deleteReconciliationRecordEntity(
  prisma: PrismaService,
  recordId: number,
): Promise<void> {
  await prisma.financeReconciliationRecord.delete({
    where: { id: recordId },
  });
}
