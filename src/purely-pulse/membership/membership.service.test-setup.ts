import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../../purely-profit/member/platform-membership/platform-membership-access.service';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';
import { NewCustomerQuotaService } from '../../purely-profit/member/new-customer-quota/new-customer-quota.service';
import { createNewCustomerQuotaServiceMock } from '../../purely-profit/member/new-customer-quota/new-customer-quota.spec-helpers';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminBeansMutationService } from './membership-admin-beans-mutation.service';
import { PulseMembershipAdminClubStatsService } from './membership-admin-club-stats.service';
import { PulseMembershipAdminLogsQueryService } from './membership-admin-logs-query.service';
import { PulseMembershipAdminMemberReadService } from './membership-admin-member-read.service';
import { PulseMembershipAdminMembershipMutationService } from './membership-admin-membership-mutation.service';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import { PulseMembershipAdminMutationService } from './membership-admin-mutation.service';
import { PulseMembershipAdminPointsMutationService } from './membership-admin-points-mutation.service';
import { PulseMembershipAdminStatusMutationService } from './membership-admin-status-mutation.service';
import { PulseMembershipAdminSubAccountMutationService } from './membership-admin-sub-account-mutation.service';
import { PulseMembershipAdminSalesStatsService } from './membership-admin-sales-stats.service';
import { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import { PulseMembershipAdminQueryService } from './membership-admin-query.service';
import { PulseMembershipAdminService } from './membership-admin.service';
import { PulseMembershipAdminSubAccountReadService } from './membership-admin-sub-account-read.service';
import { PulseMembershipLedgerService } from './membership-ledger.service';
import { PulseMembershipOrdersService } from './membership-orders.service';
import { PulseMembershipService } from './membership.service';
import {
  createAuthenticatedUser,
  createCacheInvalidatorServiceMock,
  createConfigServiceMock,
  createPlatformMembershipAccessServiceMock,
  createPlatformMembershipServiceMock,
  createPrismaServiceMock,
  createPulseStoreContextServiceMock,
  createRedisServiceMock,
  type PulseMembershipCacheInvalidatorServiceMock,
  type PulseMembershipPlatformAccessServiceMock,
  type PulseMembershipPlatformMembershipServiceMock,
  type PulseMembershipPrismaServiceMock,
  type PulseMembershipRedisServiceMock,
  type PulseMembershipStoreContextServiceMock,
} from './membership.service.test-mocks';

export type {
  PulseMembershipCacheInvalidatorServiceMock,
  PulseMembershipPlatformAccessServiceMock,
  PulseMembershipPlatformMembershipServiceMock,
  PulseMembershipPrismaServiceMock,
  PulseMembershipRedisServiceMock,
  PulseMembershipStoreContextServiceMock,
} from './membership.service.test-mocks';

export interface PulseMembershipServiceTestingContext {
  service: PulseMembershipService;
  adminService: PulseMembershipAdminService;
  mutationService: PulseMembershipAdminMutationService;
  membershipMutationService: PulseMembershipAdminMembershipMutationService;
  statusMutationService: PulseMembershipAdminStatusMutationService;
  queryService: PulseMembershipAdminQueryService;
  memberReadService: PulseMembershipAdminMemberReadService;
  platformMembershipService: PulseMembershipPlatformMembershipServiceMock;
  platformMembershipAccessService: PulseMembershipPlatformAccessServiceMock;
  prismaService: PulseMembershipPrismaServiceMock;
  pulseStoreContextService: PulseMembershipStoreContextServiceMock;
  redisService: PulseMembershipRedisServiceMock;
  cacheInvalidatorService: PulseMembershipCacheInvalidatorServiceMock;
  authSessionService: Record<string, jest.Mock>;
  user: AuthenticatedUser;
}

function createAuthSessionServiceMock(): Record<string, jest.Mock> {
  return {
    bumpTokenVersion: jest.fn().mockResolvedValue(undefined),
    getTokenVersion: jest.fn().mockResolvedValue(0),
    removeAllSessions: jest.fn().mockResolvedValue(undefined),
    invalidateAllRefreshTokens: jest.fn().mockResolvedValue(undefined),
    isSessionActive: jest.fn().mockResolvedValue(true),
    registerSession: jest.fn().mockResolvedValue('test-sid'),
  };
}

function createStoreSubAccountServiceMock() {
  return {
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
  };
}

export async function createPulseMembershipServiceTestingContext(): Promise<PulseMembershipServiceTestingContext> {
  const platformMembershipService = createPlatformMembershipServiceMock();
  const platformMembershipAccessService =
    createPlatformMembershipAccessServiceMock();
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
      PulseMembershipAdminClubStatsService,
      PulseMembershipAdminSalesStatsService,
      PulseMembershipAdminLogsQueryService,
      PulseMembershipAdminMutationStateService,
      PulseMembershipAdminMembershipMutationService,
      PulseMembershipAdminPointsMutationService,
      PulseMembershipAdminBeansMutationService,
      PulseMembershipAdminStatusMutationService,
      PulseMembershipAdminSubAccountMutationService,
      PulseMembershipAdminMutationService,
      StoreMembershipLockedPriceService,
      PulseMembershipAdminMemberReadService,
      PulseMembershipAdminSubAccountReadService,
      {
        provide: PlatformMembershipService,
        useValue: platformMembershipService,
      },
      { provide: PrismaService, useValue: prismaService },
      {
        provide: NewCustomerQuotaService,
        useValue: createNewCustomerQuotaServiceMock(),
      },
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
        provide: AuthSessionService,
        useValue: createAuthSessionServiceMock(),
      },
      {
        provide: StoreSubAccountService,
        useValue: createStoreSubAccountServiceMock(),
      },
      {
        provide: PlatformMembershipAccessService,
        useValue: platformMembershipAccessService,
      },
    ],
  }).compile();

  const authSessionService =
    module.get<Record<string, jest.Mock>>(AuthSessionService);

  return {
    service: module.get<PulseMembershipService>(PulseMembershipService),
    adminService: module.get<PulseMembershipAdminService>(
      PulseMembershipAdminService,
    ),
    mutationService: module.get<PulseMembershipAdminMutationService>(
      PulseMembershipAdminMutationService,
    ),
    membershipMutationService:
      module.get<PulseMembershipAdminMembershipMutationService>(
        PulseMembershipAdminMembershipMutationService,
      ),
    statusMutationService:
      module.get<PulseMembershipAdminStatusMutationService>(
        PulseMembershipAdminStatusMutationService,
      ),
    queryService: module.get<PulseMembershipAdminQueryService>(
      PulseMembershipAdminQueryService,
    ),
    memberReadService: module.get<PulseMembershipAdminMemberReadService>(
      PulseMembershipAdminMemberReadService,
    ),
    platformMembershipService,
    platformMembershipAccessService,
    prismaService,
    pulseStoreContextService,
    redisService,
    cacheInvalidatorService,
    authSessionService,
    user: createAuthenticatedUser(),
  };
}
