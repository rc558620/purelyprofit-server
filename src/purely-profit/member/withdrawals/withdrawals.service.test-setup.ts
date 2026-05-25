import { Test, TestingModule } from '@nestjs/testing';
import { PartnerWithdrawalStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { WithdrawalsSharedService } from './withdrawals-shared.service';
import { WithdrawalsService } from './withdrawals.service';

export interface WithdrawalsPrismaServiceMock {
  storePartner: {
    findUnique: jest.Mock;
    updateMany: jest.Mock;
  };
  storePartnerBeanLog: {
    create: jest.Mock;
  };
  partnerWithdrawal: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
  };
  $transaction: jest.Mock;
}

export interface WithdrawalsServiceTestingContext {
  service: WithdrawalsService;
  prismaService: WithdrawalsPrismaServiceMock;
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
      updateMany: jest.fn(),
    },
    storePartnerBeanLog: {
      create: jest.fn(),
    },
    partnerWithdrawal: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
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
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
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
  status: 'pending' | 'approved';
  beanBalance: number;
  totalWithdrawnBeans: number;
} {
  return {
    status: 'approved',
    beanBalance: 1200,
    totalWithdrawnBeans: 800,
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

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WithdrawalsService,
      WithdrawalsSharedService,
      { provide: PrismaService, useValue: prismaService },
    ],
  }).compile();

  return {
    service: module.get<WithdrawalsService>(WithdrawalsService),
    prismaService,
    user: createAuthenticatedUser(),
  };
}
