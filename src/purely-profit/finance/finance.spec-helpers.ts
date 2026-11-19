import type { Provider } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { FinanceAccessService } from './finance-access.service';
import { FinanceAccountService } from './finance-account.service';
import { FinanceCashFlowService } from './finance-cash-flow.service';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceReconciliationService } from './finance-reconciliation.service';

const FINANCE_SPEC_TIME = new Date('2026-05-14T12:00:00.000Z');

function createRefreshableCacheServiceMock() {
  return {
    getOrLoadRefreshableJson: jest.fn(
      async (options: { loadValue: () => Promise<unknown> }) =>
        options.loadValue(),
    ),
    writeRefreshableJson: jest.fn().mockResolvedValue(undefined),
  };
}

function createCacheInvalidatorServiceMock() {
  return {
    invalidateDashboardAndPulseSession: jest.fn().mockResolvedValue(undefined),
    invalidateDashboardAndPulseSessionQuietly: jest
      .fn()
      .mockResolvedValue(undefined),
    invalidateFinanceDerived: jest.fn().mockResolvedValue(undefined),
    invalidateFinanceDerivedQuietly: jest.fn().mockResolvedValue(undefined),
  };
}

export function createFinanceSpecUser(): AuthenticatedUser {
  return {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'owner',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };
}

export function useFinanceSpecFakeTimers(): void {
  jest.useFakeTimers().setSystemTime(FINANCE_SPEC_TIME);
}

export function useFinanceSpecRealTimers(): void {
  jest.useRealTimers();
}

/** 会员规则快照 mock（默认：已开通财务、可导出报表、无历史窗口限制） */
export function createMembershipRuleSnapshotMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    level: 'pro',
    productLimit: null,
    employeeLimit: null,
    spaceLimit: null,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
    subAccountEligible: true,
    ...overrides,
  };
}

/**
 * 会员访问上下文 mock：一次读档产出「快照 + 裁剪器」。
 *
 * 裁剪器默认原样返回，需要「被裁空 / 被截断」的场景用 `clamp` 覆盖。
 */
export function createMembershipAccessContextMock(options?: {
  snapshot?: Record<string, unknown> | null;
  clamp?: (range: { start: number; end: number }) => {
    start: number;
    end: number;
    empty: boolean;
  };
}) {
  return {
    snapshot:
      options?.snapshot === undefined
        ? createMembershipRuleSnapshotMock()
        : options.snapshot,
    clamp: jest.fn(
      options?.clamp ??
        ((range: { start: number; end: number }) => ({
          ...range,
          empty: false,
        })),
    ),
  };
}

export function createPlatformMembershipAccessServiceMock() {
  return {
    createMembershipAccessContext: jest.fn(() =>
      Promise.resolve(createMembershipAccessContextMock()),
    ),
  };
}

export function createFinanceOverviewPrismaMock() {
  return {
    financeCashFlowRecord: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    financeAccountRecord: {
      findMany: jest.fn(),
      // 未结清账款合计改走 groupBy 聚合（不再用明细行累加）；默认无未结清账款
      groupBy: jest.fn(() => Promise.resolve<unknown[]>([])),
    },
    $queryRaw: jest.fn(),
  };
}

export function createFinanceCashFlowPrismaMock() {
  return {
    financeCashFlowRecord: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

export function createFinanceAccountPrismaMock() {
  const financeAccountRecord = {
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  };

  return {
    financeAccountRecord,
    $queryRaw: jest.fn(),
    $transaction: jest.fn(
      async (
        callback: (tx: {
          financeAccountRecord: typeof financeAccountRecord;
        }) => Promise<unknown>,
      ) => callback({ financeAccountRecord }),
    ),
  };
}

export function createFinanceReconciliationPrismaMock() {
  const financeReconciliationRecord = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  };

  return {
    financeReconciliationRecord,
    $queryRaw: jest.fn(),
    $transaction: jest.fn(
      async (
        callback: (tx: {
          financeReconciliationRecord: typeof financeReconciliationRecord;
        }) => Promise<unknown>,
      ) => callback({ financeReconciliationRecord }),
    ),
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
    {
      provide: RefreshableCacheService,
      useValue: createRefreshableCacheServiceMock(),
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
    {
      provide: CacheInvalidatorService,
      useValue: createCacheInvalidatorServiceMock(),
    },
    {
      provide: RefreshableCacheService,
      useValue: createRefreshableCacheServiceMock(),
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
    {
      provide: CacheInvalidatorService,
      useValue: createCacheInvalidatorServiceMock(),
    },
    {
      provide: RefreshableCacheService,
      useValue: createRefreshableCacheServiceMock(),
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
    {
      provide: CacheInvalidatorService,
      useValue: createCacheInvalidatorServiceMock(),
    },
    {
      provide: RefreshableCacheService,
      useValue: createRefreshableCacheServiceMock(),
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
