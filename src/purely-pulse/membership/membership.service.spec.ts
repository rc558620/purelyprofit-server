import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { PulseMembershipService } from './membership.service';

describe('PulseMembershipService', () => {
  let service: PulseMembershipService;

  const platformMembershipService = {
    listPlans: jest.fn(),
    getPlanConfig: jest.fn(),
    getCenterByStoreId: jest.fn(),
    listPointsLogsByStoreId: jest.fn(),
    listBeanLogsByStoreId: jest.fn(),
  };

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
    $transaction: jest.fn(
      async (callback: (tx: PrismaService) => Promise<unknown>) =>
        callback(prismaService as unknown as PrismaService),
    ),
  };

  const pulseStoreContextService = {
    resolveTargetStoreOrThrow: jest.fn(),
    resolveTargetStore: jest.fn(),
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'pulse.devAccountEmails') {
        return ['dev@example.com'];
      }
      return undefined;
    }),
  };

  const user: AuthenticatedUser = {
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

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseMembershipService,
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

    service = module.get<PulseMembershipService>(PulseMembershipService);
  });

  it('listPlans 直接复用平台会员配置读取结果', async () => {
    platformMembershipService.listPlans.mockResolvedValue([
      {
        id: 'monthly',
        name: '月度会员',
        price: 4800,
        originalPrice: 4800,
        durationMonths: 1,
        monthlyPrice: 4800,
      },
    ]);

    await expect(service.listPlans()).resolves.toEqual([
      {
        id: 'monthly',
        name: '月度会员',
        price: 4800,
        originalPrice: 4800,
        durationMonths: 1,
        monthlyPrice: 4800,
      },
    ]);
  });

  it('getCenter 通过显式 storeId 读取目标商家订阅中心', async () => {
    pulseStoreContextService.resolveTargetStoreOrThrow.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: '0755-12345678',
      ownerId: 301,
      ownerName: '张三',
    });
    platformMembershipService.getCenterByStoreId.mockResolvedValue({
      memberInfo: {
        isActive: true,
        planId: 'quarterly',
        expiredAt: new Date('2026-05-30T00:00:00.000Z').getTime(),
        inviteCode: 'PP-18',
        totalPoints: 300,
        availablePoints: 120,
      },
      remainingDays: 9,
      stats: { totalPromos: 2, chargedPromos: 1 },
      paidOrderCount: 4,
      myPartnerApplication: null,
      approvedPartner: null,
    });

    const result = await service.getCenter(user);

    expect(pulseStoreContextService.resolveTargetStoreOrThrow).toHaveBeenCalledWith(
      user,
      {
        notFoundMessage: '当前未选中目标商家门店，暂无法查看订阅中心',
      },
    );
    expect(platformMembershipService.getCenterByStoreId).toHaveBeenCalledWith(18);
    expect(result.paidOrderCount).toBe(4);
  });

  it('previewOrder 使用平台会员配置表中的套餐价格', async () => {
    pulseStoreContextService.resolveTargetStoreOrThrow.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: '0755-12345678',
      ownerId: 301,
      ownerName: '张三',
    });
    platformMembershipService.getPlanConfig.mockResolvedValue({
      id: 'quarterly',
      name: '季度会员',
      price: 12300,
      originalPrice: 12300,
      durationMonths: 3,
      monthlyPrice: 4100,
      badge: '新价格',
      recommended: true,
    });
    prismaService.storeMembershipProfile.findFirst.mockResolvedValue({
      availablePoints: 500,
    });
    prismaService.storePartner.findFirst.mockResolvedValue({
      beanBalance: 20,
    });

    await expect(
      service.previewOrder(user, {
        planId: 'quarterly',
        usePoints: 0,
        useBeans: 0,
      }),
    ).resolves.toMatchObject({
      planId: 'quarterly',
      planName: '季度会员',
      originalPrice: 12300,
      finalAmount: 12300,
      bonusPoints: 300,
      availablePoints: 500,
      availableBeans: 20,
    });
    expect(platformMembershipService.getPlanConfig).toHaveBeenCalledWith(
      'quarterly',
    );
  });

  it('listPointsLogs 在开发者未选门店时返回聚合积分流水', async () => {
    pulseStoreContextService.resolveTargetStore.mockResolvedValue({
      store: null,
      source: null,
    });
    prismaService.storeMembershipProfile.findMany.mockResolvedValue([
      {
        storeId: 18,
        currentPlanId: 'quarterly',
        expiresAt: new Date('2027-05-21T10:00:00.000Z'),
        totalPoints: 120,
        availablePoints: 80,
      },
      {
        storeId: 19,
        currentPlanId: null,
        expiresAt: null,
        totalPoints: 40,
        availablePoints: 10,
      },
    ]);
    prismaService.storeMembershipPointsLog.findMany.mockResolvedValue([
      {
        id: 21,
        source: 'purchase_bonus',
        changeAmount: 100,
        description: '购买会员赠送积分',
        expireAt: new Date('2027-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-21T10:00:00.000Z'),
      },
      {
        id: 22,
        source: 'expire',
        changeAmount: -30,
        description: '积分过期扣减',
        expireAt: null,
        createdAt: new Date('2026-05-20T10:00:00.000Z'),
      },
    ]);

    const result = await service.listPointsLogs(user);

    expect(pulseStoreContextService.resolveTargetStore).toHaveBeenCalledWith(user);
    expect(prismaService.storeMembershipProfile.findMany).toHaveBeenCalledWith({
      where: {
        store: {
          owner: {
            email: {
              notIn: ['dev@example.com'],
            },
          },
        },
      },
      select: {
        storeId: true,
        currentPlanId: true,
        expiresAt: true,
        totalPoints: true,
        availablePoints: true,
      },
    });
    expect(prismaService.storeMembershipPointsLog.findMany).toHaveBeenCalledWith({
      where: {
        store: {
          owner: {
            email: {
              notIn: ['dev@example.com'],
            },
          },
        },
      },
      select: {
        id: true,
        source: true,
        changeAmount: true,
        description: true,
        expireAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(result).toEqual({
      memberInfo: {
        isActive: true,
        planId: null,
        expiredAt: null,
        inviteCode: 'PULSE',
        totalPoints: 160,
        availablePoints: 90,
      },
      overview: {
        availablePoints: 90,
        totalEarned: 100,
        totalSpent: 30,
      },
      items: [
        {
          id: 'pts-21',
          amount: 100,
          type: 'earn',
          source: 'purchase_bonus',
          description: '购买会员赠送积分',
          createdAt: new Date('2026-05-21T10:00:00.000Z').getTime(),
          expireAt: new Date('2027-01-01T00:00:00.000Z').getTime(),
        },
        {
          id: 'pts-22',
          amount: -30,
          type: 'expire',
          source: 'expire',
          description: '积分过期扣减',
          createdAt: new Date('2026-05-20T10:00:00.000Z').getTime(),
          expireAt: undefined,
        },
      ],
    });
  });

  it('listBeanLogs 在开发者未选门店时返回聚合纯利豆流水', async () => {
    pulseStoreContextService.resolveTargetStore.mockResolvedValue({
      store: null,
      source: null,
    });
    prismaService.storePartner.findMany.mockResolvedValue([
      {
        beanBalance: 12,
        totalEarnedBeans: 30,
        totalWithdrawnBeans: 5,
      },
      {
        beanBalance: 8,
        totalEarnedBeans: 20,
        totalWithdrawnBeans: 3,
      },
    ]);
    prismaService.storePartnerBeanLog.findMany.mockResolvedValue([
      {
        id: 11,
        source: 'promo_reward',
        changeAmount: 10,
        description: '推广奖励',
        relatedPromoRecordId: 101,
        relatedPlanType: 'quarterly',
        relatedUser: '138****0001',
        createdAt: new Date('2026-05-21T10:00:00.000Z'),
      },
      {
        id: 12,
        source: 'withdrawal',
        changeAmount: -4,
        description: '提现扣减',
        relatedPromoRecordId: null,
        relatedPlanType: null,
        relatedUser: null,
        createdAt: new Date('2026-05-20T10:00:00.000Z'),
      },
    ]);

    const result = await service.listBeanLogs(user);

    expect(pulseStoreContextService.resolveTargetStore).toHaveBeenCalledWith(user);
    expect(prismaService.storePartner.findMany).toHaveBeenCalledWith({
      where: {
        status: 'approved',
        store: {
          owner: {
            email: {
              notIn: ['dev@example.com'],
            },
          },
        },
      },
      select: {
        beanBalance: true,
        totalEarnedBeans: true,
        totalWithdrawnBeans: true,
      },
    });
    expect(prismaService.storePartnerBeanLog.findMany).toHaveBeenCalledWith({
      where: {
        store: {
          owner: {
            email: {
              notIn: ['dev@example.com'],
            },
          },
        },
      },
      select: {
        id: true,
        source: true,
        changeAmount: true,
        description: true,
        relatedPromoRecordId: true,
        relatedPlanType: true,
        relatedUser: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(result).toEqual({
      approvedPartner: null,
      overview: {
        beanBalance: 20,
        totalEarnedBeans: 50,
        totalWithdrawnBeans: 8,
      },
      items: [
        {
          id: '11',
          amount: 10,
          type: 'earn',
          source: 'promo_reward',
          description: '推广奖励',
          relatedPromoId: '101',
          relatedPlanType: 'quarterly',
          relatedUser: '138****0001',
          createdAt: new Date('2026-05-21T10:00:00.000Z').getTime(),
        },
        {
          id: '12',
          amount: -4,
          type: 'withdraw',
          source: 'withdrawal',
          description: '提现扣减',
          relatedPlanType: undefined,
          relatedUser: undefined,
          createdAt: new Date('2026-05-20T10:00:00.000Z').getTime(),
        },
      ],
    });
  });

  it('purchaseOrder 在观察态下显式拒绝代商家创建订单', async () => {
    pulseStoreContextService.resolveTargetStoreOrThrow.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: '0755-12345678',
      ownerId: 301,
      ownerName: '张三',
    });

    await expect(
      service.purchaseOrder(user, {
        planId: 'quarterly',
        usePoints: 100,
        useBeans: 2,
      }),
    ).rejects.toThrow(
      new ForbiddenException(
        'Pulse 当前按开发者观察态运行，暂不支持代目标商家创建订阅订单',
      ),
    );
  });

  it('listAdminMembers 将平台会员映射为 Pulse 会员列表', async () => {
    prismaService.storeMembershipProfile.findMany.mockResolvedValue([
      { storeId: 18 },
    ]);
    prismaService.store.findUnique.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      contactPhone: null,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
      owner: {
        email: 'phone_13619654020@purelyprofit.local',
        name: null,
        realName: '张三',
      },
    });
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'quarterly',
      expiresAt: new Date('2027-11-09T02:22:50.155Z'),
      totalPoints: 2100,
      availablePoints: 2100,
    });
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([
      {
        id: 3,
        planId: 'quarterly',
        planName: '季度会员',
        amount: 9900,
        createdAt: new Date('2026-05-21T10:48:50.390Z'),
      },
    ]);
    prismaService.storePartner.findFirst.mockResolvedValue(null);
    prismaService.storeMembershipPromoRecord.count.mockResolvedValue(0);

    const result = await service.listAdminMembers(user, {});

    expect(prismaService.storeMembershipProfile.findMany).toHaveBeenCalledWith({
      where: {
        store: {
          owner: {
            email: {
              notIn: ['dev@example.com'],
            },
          },
        },
      },
      select: {
        storeId: true,
      },
      orderBy: {
        storeId: 'asc',
      },
    });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: '18',
      name: '张三',
      phone: '13619654020',
      status: 'active',
      level: 'quarterly',
      availablePoints: 2100,
      totalRecharged: 9900,
    });
  });

  it('listAdminMembers 会保留免费会员', async () => {
    prismaService.storeMembershipProfile.findMany.mockResolvedValue([
      { storeId: 18 },
    ]);
    prismaService.store.findUnique.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      contactPhone: '13619654020',
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
      owner: {
        email: 'phone_13619654020@purelyprofit.local',
        name: null,
        realName: '张三',
      },
    });
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: null,
      expiresAt: null,
      totalPoints: 2100,
      availablePoints: 2100,
    });
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);
    prismaService.storePartner.findFirst.mockResolvedValue(null);
    prismaService.storeMembershipPromoRecord.count.mockResolvedValue(0);

    const result = await service.listAdminMembers(user, {});

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: '18',
      level: 'free',
      availablePoints: 2100,
      totalRecharged: 0,
    });
  });

  it('setAdminMemberMembership 支持设置为免费会员', async () => {
    jest
      .spyOn(service as any, 'assertAdminMemberMutationAccess')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'buildAdminMemberDetail').mockResolvedValue({
      id: '18',
      name: '张三',
      phone: '13619654020',
      avatarChar: '张',
      avatarColorIdx: 0,
      status: 'active',
      level: 'free',
      registeredAt: new Date('2026-05-01T00:00:00.000Z').getTime(),
      lastActiveAt: new Date('2026-05-21T00:00:00.000Z').getTime(),
      availablePoints: 0,
      totalPointsEarned: 0,
      beanBalance: 0,
      isPartner: false,
      totalRecharged: 0,
      rechargeCount: 0,
      invitedCount: 0,
      rechargeHistory: [],
      membershipExpiry: null,
    });

    const result = await service.setAdminMemberMembership(user, 18, {
      level: 'free',
    });

    expect(prismaService.storeMembershipProfile.upsert).toHaveBeenCalledWith({
      where: { storeId: 18 },
      create: {
        storeId: 18,
        currentPlanId: null,
        startsAt: null,
        expiresAt: null,
        totalPoints: 0,
        availablePoints: 0,
      },
      update: {
        currentPlanId: null,
        startsAt: null,
        expiresAt: null,
      },
    });
    expect(result.level).toBe('free');
    expect(result.membershipExpiry).toBeNull();
  });

  it('setAdminMemberMembership 设置为 lifetime 时按配置有效期落盘', async () => {
    const fixedNow = new Date('2026-05-23T00:00:00.000Z');
    const expectedExpiry = new Date(
      fixedNow.getTime() + 730 * 24 * 60 * 60 * 1000,
    );
    jest.useFakeTimers().setSystemTime(fixedNow);
    jest
      .spyOn(service as any, 'assertAdminMemberMutationAccess')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'buildAdminMemberDetail').mockResolvedValue({
      id: '18',
      name: '张三',
      phone: '13619654020',
      avatarChar: '张',
      avatarColorIdx: 0,
      status: 'active',
      level: 'lifetime',
      registeredAt: fixedNow.getTime(),
      lastActiveAt: fixedNow.getTime(),
      availablePoints: 0,
      totalPointsEarned: 0,
      beanBalance: 0,
      isPartner: false,
      totalRecharged: 0,
      rechargeCount: 0,
      invitedCount: 0,
      rechargeHistory: [],
      membershipExpiry: expectedExpiry.getTime(),
    });
    platformMembershipService.getPlanConfig.mockResolvedValue({
      id: 'lifetime',
      name: '永久会员',
      price: 39800,
      originalPrice: null,
      durationMonths: null,
      validDays: 730,
    });

    try {
      const result = await service.setAdminMemberMembership(user, 18, {
        level: 'lifetime',
      });

      expect(platformMembershipService.getPlanConfig).toHaveBeenCalledWith(
        'lifetime',
      );
      expect(prismaService.storeMembershipProfile.upsert).toHaveBeenCalledWith({
        where: { storeId: 18 },
        create: {
          storeId: 18,
          currentPlanId: 'lifetime',
          startsAt: fixedNow,
          expiresAt: expectedExpiry,
          totalPoints: 0,
          availablePoints: 0,
        },
        update: {
          currentPlanId: 'lifetime',
          startsAt: fixedNow,
          expiresAt: expectedExpiry,
        },
      });
      expect(result.level).toBe('lifetime');
      expect(result.membershipExpiry).toBe(expectedExpiry.getTime());
    } finally {
      jest.useRealTimers();
    }
  });

  it('getAdminMemberDetail 返回平台会员详情', async () => {
    prismaService.store.findUnique.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      contactPhone: '13619654020',
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
      owner: {
        email: 'phone_13619654020@purelyprofit.local',
        name: null,
        realName: '张三',
      },
    });
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'yearly',
      expiresAt: new Date('2027-11-09T02:22:50.155Z'),
      totalPoints: 2100,
      availablePoints: 2100,
    });
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([
      {
        id: 3,
        planId: 'quarterly',
        planName: '季度会员',
        amount: 9900,
        createdAt: new Date('2026-05-21T10:48:50.390Z'),
      },
      {
        id: 1,
        planId: 'yearly',
        planName: '年度会员',
        amount: 36900,
        createdAt: new Date('2026-05-18T02:22:50.168Z'),
      },
    ]);
    prismaService.storePartner.findFirst.mockResolvedValue({
      beanBalance: 12,
      status: 'approved',
      totalEarnedBeans: 12,
      totalWithdrawnBeans: 0,
    });
    prismaService.storeMembershipPromoRecord.count.mockResolvedValue(2);

    const result = await service.getAdminMemberDetail(user, 18);

    expect(result).toMatchObject({
      id: '18',
      name: '张三',
      phone: '13619654020',
      level: 'annual',
      isPartner: true,
      beanBalance: 12,
      invitedCount: 2,
      rechargeCount: 2,
      totalRecharged: 46800,
    });
    expect(result.rechargeHistory).toHaveLength(2);
  });

  it('getAdminMemberDetail 不返回开发者账号自身门店', async () => {
    prismaService.store.findUnique.mockResolvedValue({
      owner: {
        email: 'dev@example.com',
      },
    });

    await expect(service.getAdminMemberDetail(user, 101)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('banAdminMember 封号时会主动踢下线门店所有用户', async () => {
    jest
      .spyOn(service as any, 'assertAdminMemberMutationAccess')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'buildAdminMemberDetail').mockResolvedValue({
      id: '18',
      name: '张三',
      phone: '13619654020',
      avatarChar: '张',
      avatarColorIdx: 0,
      status: 'banned',
      level: 'annual',
      registeredAt: new Date('2026-05-01T00:00:00.000Z').getTime(),
      lastActiveAt: new Date('2026-05-21T00:00:00.000Z').getTime(),
      availablePoints: 0,
      totalPointsEarned: 0,
      beanBalance: 0,
      isPartner: false,
      totalRecharged: 0,
      rechargeCount: 0,
      invitedCount: 0,
      rechargeHistory: [],
      membershipExpiry: null,
    });

    // 门店有 ownerId=301，另有一个 staff userId=302
    prismaService.store.findUnique.mockResolvedValue({
      ownerId: 301,
      staffs: [{ userId: 302 }],
    });
    // 分两次 get：版本查询依次返回 0、1
    redisService.get
      .mockResolvedValueOnce('0')   // owner token version
      .mockResolvedValueOnce('1');  // staff token version
    redisService.set.mockResolvedValue(undefined);

    await service.banAdminMember(user, 18, { reason: '违规操作' });

    // 验证 ban-reason 写入
    expect(redisService.set).toHaveBeenCalledWith(
      'pulse:membership:admin:member:18:ban-reason',
      '违规操作',
    );
    // 验证 owner 被踢下线
    expect(redisService.set).toHaveBeenCalledWith('auth:token-version:301', '1');
    // 验证 staff 被踢下线
    expect(redisService.set).toHaveBeenCalledWith('auth:token-version:302', '2');
  });

  it('banAdminMember 缺少封号原因时抛出 BadRequestException', async () => {
    jest
      .spyOn(service as any, 'assertAdminMemberMutationAccess')
      .mockResolvedValue(undefined);

    await expect(service.banAdminMember(user, 18, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(redisService.set).not.toHaveBeenCalled();
  });
});
