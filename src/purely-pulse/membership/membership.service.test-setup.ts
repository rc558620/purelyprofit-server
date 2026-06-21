import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../../purely-profit/member/platform-membership/platform-membership-access.service';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminBeansMutationService } from './membership-admin-beans-mutation.service';
import { PulseMembershipAdminMemberReadService } from './membership-admin-member-read.service';
import { PulseMembershipAdminMembershipMutationService } from './membership-admin-membership-mutation.service';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import { PulseMembershipAdminMutationService } from './membership-admin-mutation.service';
import { PulseMembershipAdminPointsMutationService } from './membership-admin-points-mutation.service';
import { PulseMembershipAdminSubAccountMutationService } from './membership-admin-sub-account-mutation.service';
import { PulseMembershipAdminQueryService } from './membership-admin-query.service';
import { PulseMembershipAdminService } from './membership-admin.service';
import { PulseMembershipAdminSubAccountReadService } from './membership-admin-sub-account-read.service';
import { PulseMembershipLedgerService } from './membership-ledger.service';
import { PulseMembershipOrdersService } from './membership-orders.service';
import { PulseMembershipService } from './membership.service';

export interface PulseMembershipPlatformMembershipServiceMock {
  listPlans: jest.Mock;
  getPlanConfig: jest.Mock;
  getCenterByStoreId: jest.Mock;
  getProfileByStoreId: jest.Mock;
  listOrdersByStoreId: jest.Mock;
  listPointsLogsByStoreId: jest.Mock;
  listBeanLogsByStoreId: jest.Mock;
  getPromoCenterByStoreId: jest.Mock;
}

export interface PulseMembershipPrismaServiceMock {
  store: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  storeMembershipProfile: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
  };
  storePartner: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  storeMembershipOrder: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    groupBy: jest.Mock;
  };
  storeMembershipPromoRecord: {
    count: jest.Mock;
    groupBy: jest.Mock;
  };
  storeMembershipPointsLog: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
  storePartnerBeanLog: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

export interface PulseMembershipStoreContextServiceMock {
  resolveTargetStoreOrThrow: jest.Mock;
  resolveTargetStore: jest.Mock;
}

export interface PulseMembershipRedisServiceMock {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  getClient: jest.Mock;
}

export interface PulseMembershipCacheInvalidatorServiceMock {
  invalidatePulseDashboardHome: jest.Mock;
  invalidatePulseDashboardOverview: jest.Mock;
  invalidatePulseDashboardRevenueDetail: jest.Mock;
  invalidatePulseGrowthEarnings: jest.Mock;
  invalidatePulseGrowthAdminQueries: jest.Mock;
  invalidatePulseSessionNotification: jest.Mock;
  invalidatePulseSessionBootstrap: jest.Mock;
  invalidatePulseOnboardingStatus: jest.Mock;
}

export interface PulseMembershipServiceTestingContext {
  service: PulseMembershipService;
  adminService: PulseMembershipAdminService;
  mutationService: PulseMembershipAdminMutationService;
  queryService: PulseMembershipAdminQueryService;
  memberReadService: PulseMembershipAdminMemberReadService;
  platformMembershipService: PulseMembershipPlatformMembershipServiceMock;
  prismaService: PulseMembershipPrismaServiceMock;
  pulseStoreContextService: PulseMembershipStoreContextServiceMock;
  redisService: PulseMembershipRedisServiceMock;
  cacheInvalidatorService: PulseMembershipCacheInvalidatorServiceMock;
  user: AuthenticatedUser;
}

function createPlatformMembershipServiceMock(): PulseMembershipPlatformMembershipServiceMock {
  return {
    listPlans: jest.fn(),
    getPlanConfig: jest.fn(),
    getCenterByStoreId: jest.fn(),
    getProfileByStoreId: jest.fn(),
    listOrdersByStoreId: jest.fn(),
    listPointsLogsByStoreId: jest.fn(),
    listBeanLogsByStoreId: jest.fn(),
    getPromoCenterByStoreId: jest.fn(),
  };
}

function createPrismaServiceMock(): PulseMembershipPrismaServiceMock {
  const prismaService = {
    store: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    storeMembershipProfile: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    storePartner: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    storeMembershipOrder: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    storeMembershipPromoRecord: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    storeMembershipPointsLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    storePartnerBeanLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  } satisfies PulseMembershipPrismaServiceMock;

  prismaService.$transaction.mockImplementation(
    async (callback: (tx: PrismaService) => Promise<unknown>) =>
      callback(prismaService as unknown as PrismaService),
  );

  return prismaService;
}

function createPulseStoreContextServiceMock(): PulseMembershipStoreContextServiceMock {
  return {
    resolveTargetStoreOrThrow: jest.fn(),
    resolveTargetStore: jest.fn(),
  };
}

function createRedisServiceMock(): PulseMembershipRedisServiceMock {
  const client = {
    mget: jest.fn(),
  };

  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    getClient: jest.fn(() => client),
  };
}

function createCacheInvalidatorServiceMock(): PulseMembershipCacheInvalidatorServiceMock {
  return {
    invalidatePulseDashboardHome: jest.fn(),
    invalidatePulseDashboardOverview: jest.fn(),
    invalidatePulseDashboardRevenueDetail: jest.fn(),
    invalidatePulseGrowthEarnings: jest.fn(),
    invalidatePulseGrowthAdminQueries: jest.fn(),
    invalidatePulseSessionNotification: jest.fn(),
    invalidatePulseSessionBootstrap: jest.fn(),
    invalidatePulseOnboardingStatus: jest.fn(),
  };
}

function createConfigServiceMock() {
  return {
    get: jest.fn((key: string) => {
      if (key === 'pulse.devAccountEmails') {
        return ['dev@example.com'];
      }
      return undefined;
    }),
  };
}

function createAuthenticatedUser(): AuthenticatedUser {
  return {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    pulseMode: 'normal',
    isPulseDeveloper: true,
    currentMembership: null,
  };
}

export async function createPulseMembershipServiceTestingContext(): Promise<PulseMembershipServiceTestingContext> {
  const platformMembershipService = createPlatformMembershipServiceMock();
  const prismaService = createPrismaServiceMock();
  const pulseStoreContextService = createPulseStoreContextServiceMock();
  const redisService = createRedisServiceMock();
  const cacheInvalidatorService = createCacheInvalidatorServiceMock();
  const configService = createConfigServiceMock();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PulseMembershipService,
      PulseMembershipAccessService,
      PulseMembershipLedgerService,
      PulseMembershipOrdersService,
      PulseMembershipAdminService,
      PulseMembershipAdminQueryService,
      PulseMembershipAdminMutationStateService,
      PulseMembershipAdminMembershipMutationService,
      PulseMembershipAdminPointsMutationService,
      PulseMembershipAdminBeansMutationService,
      PulseMembershipAdminSubAccountMutationService,
      PulseMembershipAdminMutationService,
      PulseMembershipAdminMemberReadService,
      PulseMembershipAdminSubAccountReadService,
      {
        provide: PlatformMembershipService,
        useValue: platformMembershipService,
      },
      { provide: PrismaService, useValue: prismaService },
      { provide: RedisService, useValue: redisService },
      {
        provide: CacheInvalidatorService,
        useValue: cacheInvalidatorService,
      },
      {
        provide: PulseStoreContextService,
        useValue: pulseStoreContextService,
      },
      {
        provide: ConfigService,
        useValue: configService,
      },
      {
        provide: StoreSubAccountService,
        useValue: {
          listSubAccountSlots: jest.fn().mockResolvedValue([]),
          listAssignableHandoverCandidates: jest.fn().mockResolvedValue([]),
          updateQuota: jest.fn().mockResolvedValue(undefined),
          updateSlot: jest.fn().mockResolvedValue(undefined),
          getStoreSubAccountSummary: jest.fn().mockResolvedValue({
            quota: 2,
            usedCount: 0,
            availableCount: 2,
            roleSummary: [],
            slots: [],
          }),
        },
      },
      {
        provide: PlatformMembershipAccessService,
        useValue: {
          resolveViewStoreId: jest.fn(),
          ensureCanManageEmployees: jest.fn(),
          getSubAccountBenefitSnapshot: jest.fn().mockResolvedValue({
            level: 'yearly',
            eligible: true,
            quota: 2,
            quotaMax: 10,
            enabled: true,
            rawQuota: 2,
          }),
        },
      },
    ],
  }).compile();

  return {
    service: module.get<PulseMembershipService>(PulseMembershipService),
    adminService: module.get<PulseMembershipAdminService>(
      PulseMembershipAdminService,
    ),
    mutationService: module.get<PulseMembershipAdminMutationService>(
      PulseMembershipAdminMutationService,
    ),
    queryService: module.get<PulseMembershipAdminQueryService>(
      PulseMembershipAdminQueryService,
    ),
    memberReadService: module.get<PulseMembershipAdminMemberReadService>(
      PulseMembershipAdminMemberReadService,
    ),
    platformMembershipService,
    prismaService,
    pulseStoreContextService,
    redisService,
    cacheInvalidatorService,
    user: createAuthenticatedUser(),
  };
}
