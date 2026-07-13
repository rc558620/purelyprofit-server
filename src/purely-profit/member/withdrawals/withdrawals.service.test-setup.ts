import { Test, TestingModule } from '@nestjs/testing';
import { PartnerWithdrawalStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { WithdrawalsSharedService } from './withdrawals-shared.service';
import { WithdrawalsService } from './withdrawals.service';

export interface WithdrawalsPrismaServiceMock {
  storePartner: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
  };
  storePartnerBeanLog: {
    create: jest.Mock;
  };
  partnerWithdrawal: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
  };
  $transaction: jest.Mock;
}

export interface WithdrawalsServiceTestingContext {
  service: WithdrawalsService;
  prismaService: WithdrawalsPrismaServiceMock;
  cacheInvalidatorService: {
    invalidateDashboardAndPulseSession: jest.Mock;
  };
  user: AuthenticatedUser;
}

type WithdrawalRecordOverrides = Partial<{
  id: number;
  storeId: number;
  partnerId: number;
  beanAmount: number;
  rmbAmount: number;
  accountType: 'wechat' | 'alipay' | 'bank';
  accountNo: string;
  accountName: string;
  status: PartnerWithdrawalStatus;
  appliedAt: Date;
  reviewedAt: Date | null;
  paidAt: Date | null;
  rejectReason: string | null;
}>;

type ApplyPartnerOverrides = Partial<{
  id: number;
  status: 'pending' | 'approved';
  beanBalance: number;
}>;

type OverviewPartnerOverrides = Partial<{
  status: 'pending' | 'approved';
  beanBalance: number;
  totalWithdrawnBeans: number;
}>;

function createPrismaServiceMock(): WithdrawalsPrismaServiceMock {
  return {
    storePartner: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    storePartnerBeanLog: {
      create: jest.fn(),
    },
    partnerWithdrawal: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { beanAmount: 0 } }),
    },
    $transaction: jest.fn(),
  };
}

function createAuthenticatedUser(): AuthenticatedUser {
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

export function createWithdrawalRecord(
  overrides: WithdrawalRecordOverrides = {},
): {
  id: number;
  storeId: number;
  partnerId: number;
  beanAmount: number;
  rmbAmount: number;
  accountType: 'wechat' | 'alipay' | 'bank';
  accountNo: string;
  accountName: string;
  status: PartnerWithdrawalStatus;
  appliedAt: Date;
  reviewedAt: Date | null;
  paidAt: Date | null;
  rejectReason: string | null;
} {
  return {
    id: 15,
    storeId: 18,
    partnerId: 6,
    beanAmount: 500,
    rmbAmount: 50000,
    accountType: 'wechat',
    accountNo: 'wxid_abc123',
    accountName: '张三',
    status: PartnerWithdrawalStatus.pending,
    appliedAt: new Date('2026-05-14T10:00:00.000Z'),
    reviewedAt: null,
    paidAt: null,
    rejectReason: null,
    ...overrides,
  };
}

export function createApplyPartner(overrides: ApplyPartnerOverrides = {}): {
  id: number;
  status: 'pending' | 'approved';
  beanBalance: number;
} {
  return {
    id: 6,
    status: 'approved',
    beanBalance: 1200,
    ...overrides,
  };
}

export function createOverviewPartner(
  overrides: OverviewPartnerOverrides = {},
): {
  id: number;
  status: 'pending' | 'approved';
  name: string;
  phone: string;
  beanBalance: number;
  totalEarnedBeans: number;
  totalWithdrawnBeans: number;
  joinedAt: Date;
} {
  return {
    id: 6,
    status: 'approved',
    name: '张三',
    phone: '13800138000',
    beanBalance: 1200,
    totalEarnedBeans: 2000,
    totalWithdrawnBeans: 800,
    joinedAt: new Date('2026-05-14T00:00:00.000Z'),
    ...overrides,
  };
}

export async function createWithdrawalsServiceTestingContext(): Promise<WithdrawalsServiceTestingContext> {
  const prismaService = createPrismaServiceMock();
  prismaService.$transaction.mockImplementation(
    async (
      callback: (
        transactionClient: WithdrawalsPrismaServiceMock,
      ) => Promise<unknown>,
    ) => callback(prismaService),
  );
  prismaService.storePartner.findFirst.mockImplementation(
    (...args: unknown[]) => prismaService.storePartner.findUnique(...args),
  );

  const cacheInvalidatorService = {
    invalidateDashboardAndPulseSession: jest.fn(),
    invalidateWithdrawalsDerived: jest.fn(),
    invalidatePulseGrowthEarnings: jest.fn(),
  };
  const refreshableCache = {
    getOrLoadRefreshableJson: jest
      .fn()
      .mockImplementation(
        async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
          loadValue(),
      ),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WithdrawalsService,
      WithdrawalsSharedService,
      { provide: PrismaService, useValue: prismaService },
      { provide: RefreshableCacheService, useValue: refreshableCache },
      {
        provide: CacheInvalidatorService,
        useValue: cacheInvalidatorService,
      },
    ],
  }).compile();

  return {
    service: module.get<WithdrawalsService>(WithdrawalsService),
    prismaService,
    cacheInvalidatorService,
    user: createAuthenticatedUser(),
  };
}
