import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisLockService } from '../../../redis/redis-lock.service';
import { PROMO_BEAN_REWARDS_BY_LEVEL } from './platform-membership.constants';
import { PlatformMembershipPromoService } from './platform-membership-promo.service';
import { PlatformMembershipPromoBeanReconciliationService } from './platform-membership-promo-bean-reconciliation.service';

const SHANGHAI_NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // 上海 2026-07-15 20:00
const INVITEE_PHONE = '13700137000';
const PROFIT_EMAIL = `profit_phone_${INVITEE_PHONE}@purelyprofit.local`;

function buildPrismaMock() {
  const tx = {
    storeMembershipPromoRecord: { updateMany: jest.fn() },
    storePartner: { update: jest.fn() },
    storePartnerBeanLog: { create: jest.fn() },
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
    storePartner: { update: jest.fn(), findFirst: jest.fn() },
    storePartnerBeanLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
      deleteMany: jest.fn(),
    },
    // 事务：直接以 tx 执行回调，便于断言事务内的写入序列
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    __tx: tx,
  };

  return prisma;
}

describe(' PlatformMembershipPromoService · 推广奖励发放', () => {
  let service: PlatformMembershipPromoService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let cacheInvalidator: { invalidateMembershipDerived: jest.Mock };
  let reconciliation: { runStartupReconciliation: jest.Mock };
  let dateNowSpy: jest.SpyInstance;

  beforeEach(async () => {
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(SHANGHAI_NOW);

    prisma = buildPrismaMock();
    cacheInvalidator = { invalidateMembershipDerived: jest.fn() };
    reconciliation = { runStartupReconciliation: jest.fn() };

    // 事务内的三个写入默认指向同一批 mock，便于统一断言
    prisma.__tx.storeMembershipPromoRecord.updateMany =
      prisma.storeMembershipPromoRecord.updateMany;
    prisma.__tx.storePartner.update = prisma.storePartner.update;
    prisma.__tx.storePartnerBeanLog.create = prisma.storePartnerBeanLog.create;

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformMembershipPromoService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheInvalidatorService, useValue: cacheInvalidator },
        {
          provide: PlatformMembershipPromoBeanReconciliationService,
          useValue: reconciliation,
        },
      ],
    }).compile();

    service = moduleRef.get(PlatformMembershipPromoService);

    prisma.user.findUnique.mockResolvedValue({
      email: PROFIT_EMAIL,
      wechatPhone: null,
    });
    prisma.storeMembershipPromoRecord.count.mockResolvedValue(0);
    prisma.storeMembershipPromoRecord.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.storePartner.update.mockResolvedValue({ id: 1 });
    prisma.storePartnerBeanLog.create.mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    jest.clearAllMocks();
  });

  function mockOneUnchargedPromo() {
    prisma.storeMembershipPromoRecord.findMany.mockResolvedValue([
      { id: 100, storeId: 10, partnerId: 1 },
    ]);
  }

  it('首次充值：按 star 档发放纯利豆并写入日志', async () => {
    mockOneUnchargedPromo();

    await service.tryAwardPromoReward({
      userId: 7,
      storeId: 20,
      planId: 'monthly',
      amount: 6800,
    });

    expect(prisma.storePartner.update).toHaveBeenCalledTimes(1);
    expect(prisma.storePartner.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        beanBalance: { increment: PROMO_BEAN_REWARDS_BY_LEVEL.star.monthly },
        totalEarnedBeans: {
          increment: PROMO_BEAN_REWARDS_BY_LEVEL.star.monthly,
        },
      },
    });

    expect(prisma.storePartnerBeanLog.create).toHaveBeenCalledTimes(1);
    const logArg = prisma.storePartnerBeanLog.create.mock.calls[0][0];
    expect(logArg.data.source).toBe('promo_reward');
    expect(logArg.data.changeAmount).toBe(
      PROMO_BEAN_REWARDS_BY_LEVEL.star.monthly,
    );
    expect(logArg.data.relatedPromoRecordId).toBe(100);

    // 置位成功后刷新推广人缓存
    expect(cacheInvalidator.invalidateMembershipDerived).toHaveBeenCalledWith(
      10,
    );
  });

  it('二次充值（续费）：hasCharged 已置位，不再发放', async () => {
    // 已置位的记录不会被 findMany 查出
    prisma.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

    await service.tryAwardPromoReward({
      userId: 7,
      storeId: 20,
      planId: 'monthly',
      amount: 6800,
    });

    expect(prisma.storeMembershipPromoRecord.updateMany).not.toHaveBeenCalled();
    expect(prisma.storePartner.update).not.toHaveBeenCalled();
    expect(prisma.storePartnerBeanLog.create).not.toHaveBeenCalled();
    expect(cacheInvalidator.invalidateMembershipDerived).not.toHaveBeenCalled();
  });

  it('并发重复调用：CAS 保证只发放一次', async () => {
    mockOneUnchargedPromo();

    // 模拟两个并发请求同时读到同一条未置位记录，
    // 只有第一个事务的 updateMany 命中 count=1，第二个为 count=0
    let first = true;
    prisma.storeMembershipPromoRecord.updateMany.mockImplementation(() =>
      Promise.resolve(first ? ((first = false), { count: 1 }) : { count: 0 }),
    );

    await Promise.all([
      service.tryAwardPromoReward({
        userId: 7,
        storeId: 20,
        planId: 'monthly',
        amount: 6800,
      }),
      service.tryAwardPromoReward({
        userId: 7,
        storeId: 20,
        planId: 'monthly',
        amount: 6800,
      }),
    ]);

    expect(prisma.storeMembershipPromoRecord.updateMany).toHaveBeenCalledTimes(
      2,
    );
    expect(prisma.storePartner.update).toHaveBeenCalledTimes(1);
    expect(prisma.storePartnerBeanLog.create).toHaveBeenCalledTimes(1);
  });

  it('等级口径：本月第 10 单起按 elite 发放（与展示侧一致）', async () => {
    mockOneUnchargedPromo();
    // 本单之前已有 9 人成交，含本单为 10 -> elite
    prisma.storeMembershipPromoRecord.count.mockResolvedValue(9);

    await service.tryAwardPromoReward({
      userId: 7,
      storeId: 20,
      planId: 'monthly',
      amount: 6800,
    });

    expect(prisma.storePartnerBeanLog.create).toHaveBeenCalledTimes(1);
    expect(
      prisma.storePartnerBeanLog.create.mock.calls[0][0].data.changeAmount,
    ).toBe(PROMO_BEAN_REWARDS_BY_LEVEL.elite.monthly);
  });

  it('同一手机号存在多条推广记录时，只归属最早的一条（防一单多发）', async () => {
    // 即便库里有多条，查询也必须带 take:1 + 按注册时间升序
    prisma.storeMembershipPromoRecord.findMany.mockResolvedValue([
      { id: 100, storeId: 10, partnerId: 1 },
    ]);

    await service.tryAwardPromoReward({
      userId: 7,
      storeId: 20,
      planId: 'monthly',
      amount: 6800,
    });

    const findManyArg =
      prisma.storeMembershipPromoRecord.findMany.mock.calls[0][0];
    expect(findManyArg.where).toEqual({
      inviteePhone: INVITEE_PHONE,
      hasCharged: false,
    });
    expect(findManyArg.orderBy).toEqual({ registeredAt: 'asc' });
    expect(findManyArg.take).toBe(1);

    expect(prisma.storePartner.update).toHaveBeenCalledTimes(1);
    expect(prisma.storePartnerBeanLog.create).toHaveBeenCalledTimes(1);
  });

  it('lifetime 套餐奖励为 0：置位但不写豆日志', async () => {
    mockOneUnchargedPromo();

    await service.tryAwardPromoReward({
      userId: 7,
      storeId: 20,
      planId: 'lifetime',
      amount: 19800,
    });

    expect(prisma.storeMembershipPromoRecord.updateMany).toHaveBeenCalledTimes(
      1,
    );
    expect(prisma.storePartner.update).not.toHaveBeenCalled();
    expect(prisma.storePartnerBeanLog.create).not.toHaveBeenCalled();
  });

  it('无法解析手机号时跳过发放', async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: 'someone@example.com',
      wechatPhone: null,
    });

    await service.tryAwardPromoReward({
      userId: 7,
      storeId: 20,
      planId: 'monthly',
      amount: 6800,
    });

    expect(prisma.storeMembershipPromoRecord.findMany).not.toHaveBeenCalled();
    expect(prisma.storePartner.update).not.toHaveBeenCalled();
  });

  it('启动补偿：backfill 走带锁的对账入口', async () => {
    prisma.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

    await service.backfillUnchargedPromoRecords();

    expect(reconciliation.runStartupReconciliation).toHaveBeenCalledTimes(1);
  });

  function mockBackfillCandidate() {
    prisma.storeMembershipPromoRecord.findMany.mockResolvedValue([
      {
        id: 200,
        inviteePhone: INVITEE_PHONE,
        storeId: 10,
        partnerId: 1,
        registeredAt: new Date(SHANGHAI_NOW),
      },
    ]);
    prisma.store.findFirst.mockResolvedValue({ id: 20 });
    prisma.storeMembershipOrder.findFirst.mockResolvedValue({
      amount: 6800,
      planId: 'monthly',
    });
    prisma.storePartnerBeanLog.findFirst.mockResolvedValue(null);
  }

  it('启动补偿：补发历史记录时，置位与发豆在同一事务完成', async () => {
    mockBackfillCandidate();

    await service.backfillUnchargedPromoRecords();

    expect(prisma.storeMembershipPromoRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 200, hasCharged: false },
      data: expect.objectContaining({ hasCharged: true, rewardBeans: 8 }),
    });
    expect(prisma.storePartner.update).toHaveBeenCalledTimes(1);
    expect(prisma.storePartnerBeanLog.create).toHaveBeenCalledTimes(1);
    expect(
      prisma.storePartnerBeanLog.create.mock.calls[0][0].data.description,
    ).toContain('补发');
    expect(cacheInvalidator.invalidateMembershipDerived).toHaveBeenCalledWith(
      10,
    );
  });

  it('启动补偿：事务失败时整体回滚，不置位（下轮启动可重试）', async () => {
    mockBackfillCandidate();
    // 事务中间步骤失败 -> 整个事务回滚，hasCharged 保持 false
    prisma.storePartner.update.mockRejectedValue(new Error('db down'));

    await service.backfillUnchargedPromoRecords();

    expect(prisma.storePartnerBeanLog.create).not.toHaveBeenCalled();
    // 未成功置位，不应刷新缓存；下轮 findMany(hasCharged=false) 仍会扫到该记录
    expect(cacheInvalidator.invalidateMembershipDerived).not.toHaveBeenCalled();
  });
});

describe('PlatformMembershipPromoBeanReconciliationService · 启动对账并发保护', () => {
  let service: PlatformMembershipPromoBeanReconciliationService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let redisLock: { acquireLock: jest.Mock; releaseLock: jest.Mock };
  let cacheInvalidator: { invalidateMembershipDerived: jest.Mock };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    redisLock = {
      acquireLock: jest.fn(),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    cacheInvalidator = { invalidateMembershipDerived: jest.fn() };

    // 让两个对账方法快速空跑：无任何日志需要清理 / 校正
    prisma.storePartnerBeanLog.findFirst.mockResolvedValue(null);
    prisma.storePartnerBeanLog.create.mockResolvedValue({ id: 1 });
    prisma.storePartnerBeanLog.groupBy.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformMembershipPromoBeanReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheInvalidatorService, useValue: cacheInvalidator },
        { provide: RedisLockService, useValue: redisLock },
      ],
    }).compile();

    service = moduleRef.get(PlatformMembershipPromoBeanReconciliationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('拿到锁时执行对账，并在结束后释放锁', async () => {
    redisLock.acquireLock.mockResolvedValue({
      resource: 'promo:bean-reconciliation',
      token: 'token-1',
      key: 'distributed-lock:promo:bean-reconciliation',
    });

    await service.runStartupReconciliation();

    expect(redisLock.acquireLock).toHaveBeenCalledTimes(1);
    expect(redisLock.releaseLock).toHaveBeenCalledTimes(1);
    expect(prisma.storePartnerBeanLog.groupBy).toHaveBeenCalled();
  });

  it('未拿到锁时跳过对账（防多实例并发覆盖余额）', async () => {
    redisLock.acquireLock.mockResolvedValue(null);

    await service.runStartupReconciliation();

    expect(prisma.storePartnerBeanLog.groupBy).not.toHaveBeenCalled();
    expect(redisLock.releaseLock).not.toHaveBeenCalled();
  });

  it('对账过程抛异常时仍会释放锁', async () => {
    redisLock.acquireLock.mockResolvedValue({
      resource: 'promo:bean-reconciliation',
      token: 'token-2',
      key: 'distributed-lock:promo:bean-reconciliation',
    });
    prisma.storePartnerBeanLog.groupBy.mockRejectedValueOnce(
      new Error('db down'),
    );

    await expect(service.runStartupReconciliation()).rejects.toThrow('db down');
    expect(redisLock.releaseLock).toHaveBeenCalledTimes(1);
  });
});
