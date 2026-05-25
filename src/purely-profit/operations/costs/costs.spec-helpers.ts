import type { Provider } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CostsReadService } from './costs-read.service';
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
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
    },
  };
}

export function createCostsPrismaMock() {
  return {
    costRecord: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
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
    { provide: PrismaService, useValue: prismaService },
    { provide: CommerceAccessService, useValue: commerceAccessService },
    {
      provide: PlatformMembershipAccessService,
      useValue: platformMembershipAccessService,
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
