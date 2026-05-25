import type { Provider } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceAccessService } from './finance-access.service';
import { FinanceAccountService } from './finance-account.service';
import { FinanceCashFlowService } from './finance-cash-flow.service';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceReconciliationService } from './finance-reconciliation.service';

const FINANCE_SPEC_TIME = new Date('2026-05-14T12:00:00.000Z');

export function createFinanceSpecUser(): AuthenticatedUser {
  return {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
    },
  };
}

export function useFinanceSpecFakeTimers(): void {
  jest.useFakeTimers().setSystemTime(FINANCE_SPEC_TIME);
}

export function useFinanceSpecRealTimers(): void {
  jest.useRealTimers();
}

export function createPlatformMembershipAccessServiceMock() {
  return {
    ensureFinanceFeatureEnabled: jest.fn().mockResolvedValue(undefined),
    clampHistoryRange: jest
      .fn()
      .mockImplementation(async (_storeId: number, range: { start: number; end: number }) => ({
        ...range,
        empty: false,
      })),
    ensureReportExportEnabled: jest.fn().mockResolvedValue(undefined),
  };
}

export function createFinanceOverviewPrismaMock() {
  return {
    financeCashFlowRecord: {
      findMany: jest.fn(),
    },
    financeAccountRecord: {
      findMany: jest.fn(),
    },
  };
}

export function createFinanceCashFlowPrismaMock() {
  return {
    financeCashFlowRecord: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };
}

export function createFinanceAccountPrismaMock() {
  return {
    financeAccountRecord: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

export function createFinanceReconciliationPrismaMock() {
  return {
    financeReconciliationRecord: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

export function createFinanceOverviewProviders(
  prismaService: ReturnType<typeof createFinanceOverviewPrismaMock>,
  platformMembershipAccessService: ReturnType<
    typeof createPlatformMembershipAccessServiceMock
  >,
): Provider[] {
  return [
    FinanceAccessService,
    FinanceOverviewService,
    { provide: PrismaService, useValue: prismaService },
    {
      provide: PlatformMembershipAccessService,
      useValue: platformMembershipAccessService,
    },
  ];
}

export function createFinanceCashFlowProviders(
  prismaService: ReturnType<typeof createFinanceCashFlowPrismaMock>,
  platformMembershipAccessService: ReturnType<
    typeof createPlatformMembershipAccessServiceMock
  >,
): Provider[] {
  return [
    FinanceAccessService,
    FinanceCashFlowService,
    { provide: PrismaService, useValue: prismaService },
    {
      provide: PlatformMembershipAccessService,
      useValue: platformMembershipAccessService,
    },
  ];
}

export function createFinanceAccountProviders(
  prismaService: ReturnType<typeof createFinanceAccountPrismaMock>,
  platformMembershipAccessService: ReturnType<
    typeof createPlatformMembershipAccessServiceMock
  >,
): Provider[] {
  return [
    FinanceAccessService,
    FinanceAccountService,
    { provide: PrismaService, useValue: prismaService },
    {
      provide: PlatformMembershipAccessService,
      useValue: platformMembershipAccessService,
    },
  ];
}

export function createFinanceReconciliationProviders(
  prismaService: ReturnType<typeof createFinanceReconciliationPrismaMock>,
  platformMembershipAccessService: ReturnType<
    typeof createPlatformMembershipAccessServiceMock
  >,
): Provider[] {
  return [
    FinanceAccessService,
    FinanceReconciliationService,
    { provide: PrismaService, useValue: prismaService },
    {
      provide: PlatformMembershipAccessService,
      useValue: platformMembershipAccessService,
    },
  ];
}

export function createFinanceFacadeServiceMocks() {
  return {
    financeOverviewService: {
      getOverview: jest.fn(),
      getReport: jest.fn(),
    },
    financeCashFlowService: {
      listCashFlowRecords: jest.fn(),
      getCashFlowStats: jest.fn(),
      createCashFlowRecord: jest.fn(),
      deleteCashFlowRecord: jest.fn(),
    },
    financeAccountService: {
      listAccounts: jest.fn(),
      getAccountsStats: jest.fn(),
      createAccount: jest.fn(),
      settleAccount: jest.fn(),
      deleteAccount: jest.fn(),
    },
    financeReconciliationService: {
      listReconciliations: jest.fn(),
      getReconciliationStats: jest.fn(),
      createReconciliation: jest.fn(),
      confirmReconciliation: jest.fn(),
      deleteReconciliation: jest.fn(),
    },
  };
}

export function createFinanceFacadeProviders(
  mocks: ReturnType<typeof createFinanceFacadeServiceMocks>,
): Provider[] {
  return [
    { provide: FinanceOverviewService, useValue: mocks.financeOverviewService },
    { provide: FinanceCashFlowService, useValue: mocks.financeCashFlowService },
    { provide: FinanceAccountService, useValue: mocks.financeAccountService },
    {
      provide: FinanceReconciliationService,
      useValue: mocks.financeReconciliationService,
    },
  ];
}
