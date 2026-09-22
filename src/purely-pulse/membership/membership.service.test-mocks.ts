import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { PrismaService } from '../../prisma/prisma.service';

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

/**
 * 平台会员能力服务 mock。
 *
 * `getSubAccountBenefitSnapshot` 的返回值必须**完整**覆盖真实的
 * `SubAccountBenefitSnapshot`（尤其 `featureOwned` / `previousLevel`）：
 * 缺字段会让「曾开通子账号功能」判定静默变成 false，首购锁定价等
 * 依赖该标志的分支会被悄悄跳过。
 */
export interface PulseMembershipPlatformAccessServiceMock {
  resolveViewStoreId: jest.Mock;
  ensureCanManageEmployees: jest.Mock;
  getSubAccountBenefitSnapshot: jest.Mock;
}

export interface PulseMembershipPrismaServiceMock {
  store: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  staff: {
    updateMany: jest.Mock;
  };
  user: {
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
  storeMembershipLockedPrice: {
    findMany: jest.Mock;
    createMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  storeMembershipPointsLog: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
  storePartnerBeanLog: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
  $executeRaw: jest.Mock;
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
  getJson: jest.Mock;
  setJson: jest.Mock;
  mgetJson: jest.Mock;
  delByPattern: jest.Mock;
  setIfAbsent: jest.Mock;
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

export function createPlatformMembershipServiceMock(): PulseMembershipPlatformMembershipServiceMock {
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

export function createPlatformMembershipAccessServiceMock(): PulseMembershipPlatformAccessServiceMock {
  return {
    resolveViewStoreId: jest.fn(),
    ensureCanManageEmployees: jest.fn(),
    getSubAccountBenefitSnapshot: jest.fn().mockResolvedValue({
      level: 'yearly',
      eligible: true,
      quota: 2,
      quotaMax: 10,
      enabled: true,
      rawQuota: 2,
      // 默认为「已开通子账号功能」的门店：首购锁定价、档位裁剪等分支都依赖它
      featureOwned: true,
      previousLevel: 'yearly',
    }),
  };
}

export function createPrismaServiceMock(): PulseMembershipPrismaServiceMock {
  const prismaService = {
    store: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    staff: {
      updateMany: jest.fn(),
    },
    user: {
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
    storeMembershipLockedPrice: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    storeMembershipPointsLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    storePartnerBeanLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(),
  } satisfies PulseMembershipPrismaServiceMock;

  prismaService.$transaction.mockImplementation(
    async (callback: (tx: PrismaService) => Promise<unknown>) =>
      callback(prismaService as unknown as PrismaService),
  );

  return prismaService;
}

export function createPulseStoreContextServiceMock(): PulseMembershipStoreContextServiceMock {
  return {
    resolveTargetStoreOrThrow: jest.fn(),
    resolveTargetStore: jest.fn(),
  };
}

export function createRedisServiceMock(): PulseMembershipRedisServiceMock {
  const pipeline = {
    set: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
  const client = {
    mget: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    pipeline: jest.fn(() => pipeline),
  };

  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    getClient: jest.fn(() => client),
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(undefined),
    mgetJson: jest.fn().mockResolvedValue([]),
    delByPattern: jest.fn().mockResolvedValue(1),
    setIfAbsent: jest.fn().mockResolvedValue(true),
  };
}

export function createCacheInvalidatorServiceMock(): PulseMembershipCacheInvalidatorServiceMock {
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

export function createConfigServiceMock() {
  return {
    get: jest.fn((key: string) => {
      if (key === 'pulse.devAccountEmails') {
        return ['dev@example.com'];
      }
      return undefined;
    }),
  };
}

export function createAuthenticatedUser(): AuthenticatedUser {
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
