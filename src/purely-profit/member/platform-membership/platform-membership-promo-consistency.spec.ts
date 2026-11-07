import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisLockService } from '../../../redis/redis-lock.service';
import { PlatformMembershipPromoBackfillService } from './platform-membership-promo-backfill.service';
import { PlatformMembershipPromoBeanReconciliationService } from './platform-membership-promo-bean-reconciliation.service';

const SHANGHAI_NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const INVITEE_PHONE = '13700137000';
const LOCK = {
  resource: 'promo:bean-reconciliation',
  token: 'token-1',
  key: 'distributed-lock:promo:bean-reconciliation',
};

function buildPrismaMock() {
  const tx = {
    storeMembershipPromoRecord: { updateMany: jest.fn() },
    storePartner: { update: jest.fn(), updateMany: jest.fn() },
    storePartnerBeanLog: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const prisma = {
    user: { findUnique: jest.fn() },
    store: { findFirst: jest.fn() },
    storeMembershipOrder: { findFirst: jest.fn() },
    storeMembershipPromoRecord: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    storePartner: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    storePartnerBeanLog: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    __tx: tx,
  };

  tx.storeMembershipPromoRecord.updateMany =
    prisma.storeMembershipPromoRecord.updateMany;
  tx.storePartner.update = prisma.storePartner.update;
  tx.storePartner.updateMany = prisma.storePartner.updateMany;
  tx.storePartnerBeanLog.create = prisma.storePartnerBeanLog.create;
  tx.storePartnerBeanLog.deleteMany = prisma.storePartnerBeanLog.deleteMany;

  return prisma;
}

function buildStubs() {
  return {
    cacheInvalidator: { invalidateMembershipDerived: jest.fn() },
    redisLock: {
      acquireLock: jest.fn().mockResolvedValue(LOCK),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('推广补偿 · 归属与时序一致性', () => {
  let service: PlatformMembershipPromoBackfillService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let stubs: ReturnType<typeof buildStubs>;

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(SHANGHAI_NOW);
    prisma = buildPrismaMock();
    stubs = buildStubs();

    // 补偿链路前置条件：能找到被推广人、其门店、推广后的付费订单
    prisma.user.findUnique.mockResolvedValue({ id: 7 });
    prisma.store.findFirst.mockResolvedValue({ id: 20 });
    prisma.storeMembershipOrder.findFirst.mockResolvedValue({
      amount: 6800,
      planId: 'monthly',
    });
    prisma.storeMembershipPromoRecord.count.mockResolvedValue(0);
    prisma.storeMembershipPromoRecord.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.storePartner.update.mockResolvedValue({ id: 1 });
    prisma.storePartnerBeanLog.findFirst.mockResolvedValue(null);
    prisma.storePartnerBeanLog.create.mockResolvedValue({ id: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformMembershipPromoBackfillService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CacheInvalidatorService,
          useValue: stubs.cacheInvalidator,
        },
        { provide: RedisLockService, useValue: stubs.redisLock },
        {
          provide: PlatformMembershipPromoBeanReconciliationService,
          useValue: { runStartupReconciliation: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(PlatformMembershipPromoBackfillService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  const oneRecord = (registeredAt: number) => [
    {
      id: 100,
      inviteePhone: INVITEE_PHONE,
      storeId: 10,
      partnerId: 1,
      registeredAt: new Date(registeredAt),
    },
  ];

  it('同一手机号跨门店多条记录时，只补发最早建立推广关系的一条', async () => {
    prisma.storeMembershipPromoRecord.findMany.mockResolvedValue([
      ...oneRecord(SHANGHAI_NOW - 3000),
      {
        id: 200,
        inviteePhone: INVITEE_PHONE,
        storeId: 20,
        partnerId: 2,
        registeredAt: new Date(SHANGHAI_NOW - 1000),
      },
    ]);

    await service.run();

    expect(prisma.storeMembershipPromoRecord.updateMany).toHaveBeenCalledTimes(
      1,
    );
    expect(prisma.storeMembershipPromoRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 100, hasCharged: false } }),
    );
    expect(prisma.storePartner.update).toHaveBeenCalledTimes(1);
  });

  it('补发订单查询带推广关系建立时间下界，防止推广前历史订单误触发', async () => {
    prisma.storeMembershipPromoRecord.findMany.mockResolvedValue(
      oneRecord(SHANGHAI_NOW - 3000),
    );

    await service.run();

    expect(prisma.storeMembershipOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentChannel: 'wechat',
          createdAt: { gte: new Date(SHANGHAI_NOW - 3000) },
        }),
      }),
    );
  });

  it('等级判定与发豆前必须拿到合伙人锁，拿不到锁不写库', async () => {
    stubs.redisLock.acquireLock.mockResolvedValue(null);
    prisma.storeMembershipPromoRecord.findMany.mockResolvedValue(
      oneRecord(SHANGHAI_NOW - 3000),
    );

    await service.run();

    expect(stubs.redisLock.acquireLock).toHaveBeenCalledWith(
      'promo:award:1',
      expect.objectContaining({ ttlSeconds: expect.any(Number) }),
    );
    expect(prisma.storeMembershipPromoRecord.updateMany).not.toHaveBeenCalled();
    expect(prisma.storePartner.update).not.toHaveBeenCalled();
  });
});

describe('推广豆对账 · 不覆盖在线写入', () => {
  let service: PlatformMembershipPromoBeanReconciliationService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let stubs: ReturnType<typeof buildStubs>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    stubs = buildStubs();
    // 本组直接调 reconcilePartnerBeanBalances（不经 runStartupReconciliation），
    // groupBy 只会被调用一次，返回待校正的合伙人 #5
    prisma.storePartnerBeanLog.groupBy.mockResolvedValue([{ partnerId: 5 }]);
    prisma.storePartnerBeanLog.findMany.mockResolvedValue([
      { changeAmount: 30, source: 'promo_reward' },
    ]);
    prisma.storePartner.findUnique.mockResolvedValue({
      beanBalance: 20,
      totalEarnedBeans: 45,
      storeId: 10,
    });
    prisma.storePartner.updateMany.mockResolvedValue({ count: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformMembershipPromoBeanReconciliationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CacheInvalidatorService,
          useValue: stubs.cacheInvalidator,
        },
        { provide: RedisLockService, useValue: stubs.redisLock },
      ],
    }).compile();

    service = moduleRef.get(PlatformMembershipPromoBeanReconciliationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('余额用「带条件的增量」修正，且不改写 totalEarnedBeans', async () => {
    await service.reconcilePartnerBeanBalances();

    expect(prisma.storePartner.updateMany).toHaveBeenCalledWith({
      where: { id: 5, beanBalance: 20 },
      data: { beanBalance: { increment: 10 } },
    });
    expect(prisma.storePartner.update).not.toHaveBeenCalled();
  });

  it('并发写入导致条件不命中时跳过本轮，不用旧快照覆盖余额', async () => {
    prisma.storePartner.updateMany.mockResolvedValue({ count: 0 });

    await service.reconcilePartnerBeanBalances();

    expect(prisma.storePartner.updateMany).toHaveBeenCalledTimes(1);
    expect(
      stubs.cacheInvalidator.invalidateMembershipDerived,
    ).toHaveBeenCalledWith(10);
  });
});
