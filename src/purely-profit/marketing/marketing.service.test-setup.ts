import { Test, TestingModule } from '@nestjs/testing';
import { ClubMemberLevelsService } from '../../purely-club/member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../../purely-club/member/member-profile/club-member-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import { MarketingAccessService } from './marketing-access.service';
import { MarketingConsumptionsService } from './marketing-consumptions.service';
import { MarketingCustomersService } from './marketing-customers.service';
import { MarketingOverviewService } from './marketing-overview.service';
import { MarketingPointsRecordsService } from './marketing-points-records.service';
import { MarketingProductCategoriesService } from './marketing-product-categories.service';
import { MarketingProductsService } from './marketing-products.service';
import { MarketingPromotionsService } from './marketing-promotions.service';
import { MarketingRechargesService } from './marketing-recharges.service';
import {
  MarketingCustomersFacadeService,
  MarketingOverviewFacadeService,
  MarketingProductsFacadeService,
  MarketingPromotionsFacadeService,
  MarketingService,
  MarketingTransactionsFacadeService,
} from './marketing.service';
import { MarketingSharedService } from './marketing-shared.service';

export interface MarketingPrismaServiceMock {
  marketingCustomer: {
    count: jest.Mock;
    aggregate: jest.Mock;
    groupBy: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  marketingRecharge: {
    aggregate: jest.Mock;
    count: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
  };
  marketingConsumption: {
    aggregate: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
  };
  marketingPromotion: {
    count: jest.Mock;
    updateMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    findMany: jest.Mock;
  };
  marketingMemberLevelSetting: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  marketingProductCategory: {
    count: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  marketingProduct: {
    count: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  store: {
    findUnique: jest.Mock;
  };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
}

export interface MarketingAccessServiceMock {
  resolveViewStoreId: jest.Mock;
  ensureCanAccess: jest.Mock;
}

export interface MarketingPlatformMembershipAccessServiceMock {
  ensureMarketingFeatureEnabled: jest.Mock;
}

export interface MarketingClubMemberProfileServiceMock {
  getSnapshotByStoreAndPhone: jest.Mock;
}

export interface MarketingClubMemberLevelsServiceMock {
  resolveCurrentLevelConfig: jest.Mock;
}

export interface MarketingServiceTestingContext {
  service: MarketingService;
  prismaService: MarketingPrismaServiceMock;
  accessService: MarketingAccessServiceMock;
  platformMembershipAccessService: MarketingPlatformMembershipAccessServiceMock;
  clubMemberProfileService: MarketingClubMemberProfileServiceMock;
  clubMemberLevelsService: MarketingClubMemberLevelsServiceMock;
  user: AuthenticatedUser;
}

function createPrismaServiceMock(): MarketingPrismaServiceMock {
  return {
    marketingCustomer: {
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    marketingRecharge: {
      aggregate: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    marketingConsumption: {
      aggregate: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    marketingPromotion: {
      count: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    marketingMemberLevelSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    marketingProductCategory: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    marketingProduct: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    store: {
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
}

function createAccessServiceMock(): MarketingAccessServiceMock {
  return {
    resolveViewStoreId: jest.fn(),
    ensureCanAccess: jest.fn(),
  };
}

function createPlatformMembershipAccessServiceMock(): MarketingPlatformMembershipAccessServiceMock {
  return {
    ensureMarketingFeatureEnabled: jest.fn(),
  };
}

function createClubMemberProfileServiceMock(): MarketingClubMemberProfileServiceMock {
  return {
    getSnapshotByStoreAndPhone: jest.fn(),
  };
}

function createClubMemberLevelsServiceMock(): MarketingClubMemberLevelsServiceMock {
  return {
    resolveCurrentLevelConfig: jest.fn(),
  };
}

function createRedisServiceMock() {
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
    invalidateMarketingOverview: jest.fn().mockResolvedValue(undefined),
    invalidateProfitDashboardHome: jest.fn().mockResolvedValue(undefined),
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

export async function createMarketingServiceTestingContext(): Promise<MarketingServiceTestingContext> {
  const prismaService = createPrismaServiceMock();
  const accessService = createAccessServiceMock();
  const platformMembershipAccessService =
    createPlatformMembershipAccessServiceMock();
  const clubMemberProfileService = createClubMemberProfileServiceMock();
  const clubMemberLevelsService = createClubMemberLevelsServiceMock();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MarketingService,
      MarketingOverviewFacadeService,
      MarketingCustomersFacadeService,
      MarketingTransactionsFacadeService,
      MarketingPromotionsFacadeService,
      MarketingProductsFacadeService,
      MarketingSharedService,
      MarketingOverviewService,
      MarketingCustomersService,
      MarketingRechargesService,
      MarketingPointsRecordsService,
      MarketingConsumptionsService,
      MarketingPromotionsService,
      MarketingProductCategoriesService,
      MarketingProductsService,
      { provide: PrismaService, useValue: prismaService },
      { provide: RedisService, useValue: createRedisServiceMock() },
      {
        provide: CacheInvalidatorService,
        useValue: createCacheInvalidatorServiceMock(),
      },
      { provide: MarketingAccessService, useValue: accessService },
      {
        provide: PlatformMembershipAccessService,
        useValue: platformMembershipAccessService,
      },
      {
        provide: ClubMemberProfileService,
        useValue: clubMemberProfileService,
      },
      {
        provide: ClubMemberLevelsService,
        useValue: clubMemberLevelsService,
      },
    ],
  }).compile();

  return {
    service: module.get<MarketingService>(MarketingService),
    prismaService,
    accessService,
    platformMembershipAccessService,
    clubMemberProfileService,
    clubMemberLevelsService,
    user: createAuthenticatedUser(),
  };
}
