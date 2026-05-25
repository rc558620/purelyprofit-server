import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminService } from './membership-admin.service';
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
  };
  storeMembershipPromoRecord: {
    count: jest.Mock;
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
}

export interface PulseMembershipServiceTestingContext {
  service: PulseMembershipService;
  adminService: PulseMembershipAdminService;
  platformMembershipService: PulseMembershipPlatformMembershipServiceMock;
  prismaService: PulseMembershipPrismaServiceMock;
  pulseStoreContextService: PulseMembershipStoreContextServiceMock;
  redisService: PulseMembershipRedisServiceMock;
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
    },
    storeMembershipPromoRecord: {
      count: jest.fn(),
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
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
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
  const configService = createConfigServiceMock();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PulseMembershipService,
      PulseMembershipAccessService,
      PulseMembershipLedgerService,
      PulseMembershipOrdersService,
      PulseMembershipAdminService,
      {
        provide: PlatformMembershipService,
        useValue: platformMembershipService,
      },
      { provide: PrismaService, useValue: prismaService },
      { provide: RedisService, useValue: redisService },
      {
        provide: PulseStoreContextService,
        useValue: pulseStoreContextService,
      },
      {
        provide: ConfigService,
        useValue: configService,
      },
    ],
  }).compile();

  return {
    service: module.get<PulseMembershipService>(PulseMembershipService),
    adminService: module.get<PulseMembershipAdminService>(
      PulseMembershipAdminService,
    ),
    platformMembershipService,
    prismaService,
    pulseStoreContextService,
    redisService,
    user: createAuthenticatedUser(),
  };
}
