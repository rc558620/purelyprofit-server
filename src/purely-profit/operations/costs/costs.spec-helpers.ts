import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import type { RefreshableCacheLoadOptions } from '../../../redis/refreshable-cache.types';
import { CostsReadService } from './costs-read.service';
import { CostsReadRecordsService } from './costs-read-records.service';
import { CostsReadStatsService } from './costs-read-stats.service';
import { CostsReadReportService } from './costs-read-report.service';
import { CostsReadDashboardService } from './costs-read-dashboard.service';
import { CostsService } from './costs.service';
import { CostsWriteService } from './costs-write.service';

export function createCostsSpecUser(): AuthenticatedUser {
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

export function createCostsPrismaMock() {
  return {
    costRecord: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    employeePayroll: {
      findMany: jest.fn(),
    },
  };
}

export function createCostsCommerceAccessServiceMock() {
  return {
    resolveViewStoreId: jest.fn(),
    resolveSingleStoreId: jest.fn(),
    findOperatorStaffIdForStore: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };
}

export function createCostsPlatformMembershipAccessServiceMock() {
  return {
    clampHistoryRange: jest
      .fn()
      .mockImplementation(
        (_storeId: number, range: { start: number; end: number }) =>
          Promise.resolve({
            start: range.start,
            end: range.end,
            clamped: false,
            empty: false,
          }),
      ),
    ensureReportExportEnabled: jest.fn().mockResolvedValue(undefined),
    getHistoryWindowStart: jest.fn().mockResolvedValue(null),
  };
}

export function createCostsReadProviders(
  prismaService: ReturnType<typeof createCostsPrismaMock>,
  commerceAccessService: ReturnType<
    typeof createCostsCommerceAccessServiceMock
  >,
  platformMembershipAccessService: ReturnType<
    typeof createCostsPlatformMembershipAccessServiceMock
  >,
): Provider[] {
  return [
    CostsReadService,
    CostsReadRecordsService,
    CostsReadStatsService,
    CostsReadReportService,
    CostsReadDashboardService,
    { provide: PrismaService, useValue: prismaService },
    {
      provide: RefreshableCacheService,
      useValue: {
        getOrLoadRefreshableJson: jest.fn(
          <T>(_options: RefreshableCacheLoadOptions<T>) => _options.loadValue(),
        ),
        writeRefreshableJson: jest.fn(),
      },
    },
    { provide: CommerceAccessService, useValue: commerceAccessService },
    {
      provide: PlatformMembershipAccessService,
      useValue: platformMembershipAccessService,
    },
    {
      provide: ConfigService,
      useValue: {
        get: <T>(_key: string, _defaultValue?: T) => _defaultValue ?? 100,
      },
    },
  ];
}

export function createCostsWriteProviders(
  prismaService: ReturnType<typeof createCostsPrismaMock>,
  commerceAccessService: ReturnType<
    typeof createCostsCommerceAccessServiceMock
  >,
): Provider[] {
  return [
    CostsWriteService,
    { provide: PrismaService, useValue: prismaService },
    {
      provide: CacheInvalidatorService,
      useValue: {
        invalidateProfitDashboardHome: jest.fn().mockResolvedValue(undefined),
        invalidatePulseDashboardOverview: jest
          .fn()
          .mockResolvedValue(undefined),
        invalidateCostsCaches: jest.fn().mockResolvedValue(undefined),
      },
    },
    { provide: CommerceAccessService, useValue: commerceAccessService },
  ];
}

export function createCostsFacadeServiceMocks() {
  return {
    costsReadService: {
      listRecords: jest.fn(),
      getStats: jest.fn(),
      getReport: jest.fn(),
    },
    costsWriteService: {
      createRecord: jest.fn(),
      deleteRecord: jest.fn(),
      syncPurchaseCost: jest.fn(),
      syncPayrollCosts: jest.fn(),
      deletePurchaseCostRecord: jest.fn(),
    },
  };
}

export function createCostsFacadeProviders(
  mocks: ReturnType<typeof createCostsFacadeServiceMocks>,
): Provider[] {
  return [
    CostsService,
    { provide: CostsReadService, useValue: mocks.costsReadService },
    { provide: CostsWriteService, useValue: mocks.costsWriteService },
  ];
}
