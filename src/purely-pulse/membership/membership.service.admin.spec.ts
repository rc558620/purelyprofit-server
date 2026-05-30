import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createPulseMembershipServiceTestingContext,
  type PulseMembershipServiceTestingContext,
} from './membership.service.test-setup';

describe('PulseMembershipService admin', () => {
  let context: PulseMembershipServiceTestingContext;

  beforeEach(async () => {
    jest.clearAllMocks();
    context = await createPulseMembershipServiceTestingContext();
  });

  it('listAdminPointsLogs 将 cursor 下推到查询层并返回 nextCursor', async () => {
    context.prismaService.storeMembershipProfile.findMany.mockResolvedValue([
      { storeId: 18 },
    ]);
    context.prismaService.storeMembershipPointsLog.findMany.mockResolvedValue([
      {
        id: 21,
        storeId: 18,
        source: 'purchase_bonus',
        changeAmount: 100,
        description: '购买会员赠送积分',
        expireAt: new Date('2027-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-21T10:00:00.000Z'),
        store: {
          name: '纯利宝南山店',
          contactPhone: '13619654020',
          owner: {
            email: 'phone_13619654020@purelyprofit.local',
            name: null,
            realName: '张三',
          },
        },
      },
      {
        id: 20,
        storeId: 18,
        source: 'expire',
        changeAmount: -30,
        description: '积分过期扣减',
        expireAt: null,
        createdAt: new Date('2026-05-20T10:00:00.000Z'),
        store: {
          name: '纯利宝南山店',
          contactPhone: '13619654020',
          owner: {
            email: 'phone_13619654020@purelyprofit.local',
            name: null,
            realName: '张三',
          },
        },
      },
    ]);

    const result = await context.service.listAdminPointsLogs(context.user, {
      cursor: '1747821600000_99',
      limit: 1,
    });

    expect(
      context.prismaService.storeMembershipPointsLog.findMany,
    ).toHaveBeenCalledWith({
      where: {
        storeId: { in: [18] },
        OR: [
          { createdAt: { lt: new Date('2025-05-21T10:00:00.000Z') } },
          {
            createdAt: new Date('2025-05-21T10:00:00.000Z'),
            id: { lt: 99 },
          },
        ],
      },
      select: {
        id: true,
        storeId: true,
        source: true,
        changeAmount: true,
        description: true,
        expireAt: true,
        createdAt: true,
        store: {
          select: {
            name: true,
            contactPhone: true,
            owner: {
              select: {
                email: true,
                name: true,
                realName: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
    });
    expect(result).toEqual({
      items: [
        {
          id: '21',
          userId: '18',
          userName: '张三',
          userPhone: '136****4020',
          amount: 100,
          type: 'earn',
          source: 'purchase_bonus',
          description: '购买会员赠送积分',
          createdAt: new Date('2026-05-21T10:00:00.000Z').getTime(),
          expireAt: new Date('2027-01-01T00:00:00.000Z').getTime(),
        },
      ],
      hasMore: true,
      nextCursor: `${new Date('2026-05-21T10:00:00.000Z').getTime()}_21`,
    });
  });

  it('listAdminBeanLogs 将 cursor 下推到查询层并返回 nextCursor', async () => {
    context.prismaService.storeMembershipProfile.findMany.mockResolvedValue([
      { storeId: 18 },
    ]);
    context.prismaService.storePartnerBeanLog.findMany.mockResolvedValue([
      {
        id: 11,
        storeId: 18,
        source: 'promo_reward',
        changeAmount: 10,
        description: '推广奖励',
        relatedPromoRecordId: 101,
        relatedUser: '138****0001',
        createdAt: new Date('2026-05-21T10:00:00.000Z'),
        store: {
          name: '纯利宝南山店',
          contactPhone: '13619654020',
          owner: {
            email: 'phone_13619654020@purelyprofit.local',
            name: null,
            realName: '张三',
          },
        },
      },
      {
        id: 10,
        storeId: 18,
        source: 'withdrawal',
        changeAmount: -4,
        description: '提现扣减',
        relatedPromoRecordId: null,
        relatedUser: null,
        createdAt: new Date('2026-05-20T10:00:00.000Z'),
        store: {
          name: '纯利宝南山店',
          contactPhone: '13619654020',
          owner: {
            email: 'phone_13619654020@purelyprofit.local',
            name: null,
            realName: '张三',
          },
        },
      },
    ]);

    const result = await context.service.listAdminBeanLogs(context.user, {
      limit: 1,
    });

    expect(
      context.prismaService.storePartnerBeanLog.findMany,
    ).toHaveBeenCalledWith({
      where: {
        storeId: { in: [18] },
      },
      select: {
        id: true,
        storeId: true,
        source: true,
        changeAmount: true,
        description: true,
        relatedPromoRecordId: true,
        relatedUser: true,
        createdAt: true,
        store: {
          select: {
            name: true,
            contactPhone: true,
            owner: {
              select: {
                email: true,
                name: true,
                realName: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
    });
    expect(result).toEqual({
      items: [
        {
          id: '11',
          userId: '18',
          userName: '张三',
          userPhone: '136****4020',
          amount: 10,
          type: 'earn',
          source: 'promo_reward',
          description: '推广奖励',
          relatedPromoId: '101',
          relatedUser: '138****0001',
          createdAt: new Date('2026-05-21T10:00:00.000Z').getTime(),
        },
      ],
      hasMore: true,
      nextCursor: `${new Date('2026-05-21T10:00:00.000Z').getTime()}_11`,
    });
  });

  it('listAdminPointsLogs cursor 非法时抛错', async () => {
    context.prismaService.storeMembershipProfile.findMany.mockResolvedValue([
      { storeId: 18 },
    ]);

    await expect(
      context.service.listAdminPointsLogs(context.user, {
        cursor: 'bad-cursor',
      }),
    ).rejects.toThrow('cursor 格式不合法');
  });

  it('listAdminMembers 将平台会员映射为 Pulse 会员列表', async () => {
    context.prismaService.storeMembershipProfile.findMany
      .mockResolvedValueOnce([{ storeId: 18 }])
      .mockResolvedValueOnce([
        {
          storeId: 18,
          currentPlanId: 'quarterly',
          expiresAt: new Date('2027-11-09T02:22:50.155Z'),
          totalPoints: 2100,
          availablePoints: 2100,
        },
      ]);
    context.prismaService.store.findMany.mockResolvedValue([
      {
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
      },
    ]);
    context.prismaService.storeMembershipOrder.groupBy.mockResolvedValue([
      {
        storeId: 18,
        _count: { _all: 1 },
        _sum: { amount: 9900 },
        _max: {
          createdAt: new Date('2026-05-21T10:48:50.390Z'),
        },
      },
    ]);
    context.prismaService.storePartner.findMany.mockResolvedValue([]);
    context.redisService.getClient = jest.fn(() => ({
      mget: jest.fn().mockResolvedValue([null]),
    }));

    const result = await context.service.listAdminMembers(context.user, {});

    expect(
      context.prismaService.storeMembershipProfile.findMany,
    ).toHaveBeenNthCalledWith(1, {
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
    expect(context.prismaService.store.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [18] },
      },
      select: {
        id: true,
        name: true,
        contactPhone: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            email: true,
            name: true,
            realName: true,
          },
        },
      },
      orderBy: [{ id: 'asc' }],
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
    context.prismaService.storeMembershipProfile.findMany
      .mockResolvedValueOnce([{ storeId: 18 }])
      .mockResolvedValueOnce([
        {
          storeId: 18,
          currentPlanId: null,
          expiresAt: null,
          totalPoints: 2100,
          availablePoints: 2100,
        },
      ]);
    context.prismaService.store.findMany.mockResolvedValue([
      {
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
      },
    ]);
    context.prismaService.storeMembershipOrder.groupBy.mockResolvedValue([]);
    context.prismaService.storePartner.findMany.mockResolvedValue([]);
    context.redisService.getClient = jest.fn(() => ({
      mget: jest.fn().mockResolvedValue([null]),
    }));

    const result = await context.service.listAdminMembers(context.user, {});

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: '18',
      level: 'free',
      availablePoints: 2100,
      totalRecharged: 0,
    });
  });

  it('listAdminMembers 将 partner、keyword、level、status 下推到批量查询', async () => {
    context.prismaService.storeMembershipProfile.findMany.mockResolvedValueOnce(
      [{ storeId: 18 }, { storeId: 19 }],
    );
    context.prismaService.store.findMany.mockResolvedValue([]);

    await expect(
      context.service.listAdminMembers(context.user, {
        partner: true,
        keyword: '13619654020',
        level: 'annual',
        status: 'active',
      }),
    ).resolves.toEqual({ items: [], total: 0 });

    expect(context.prismaService.store.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: { in: [18, 19] } },
          {
            partners: {
              some: {
                status: 'approved',
              },
            },
          },
          {
            membershipProfile: {
              is: {
                currentPlanId: 'yearly',
                expiresAt: { not: null },
              },
            },
          },
          {
            membershipProfile: {
              is: {
                expiresAt: { gt: expect.any(Date) },
              },
            },
          },
          {
            OR: [
              { name: { contains: '13619654020', mode: 'insensitive' } },
              { contactPhone: { contains: '13619654020' } },
              {
                owner: {
                  name: {
                    contains: '13619654020',
                    mode: 'insensitive',
                  },
                },
              },
              {
                owner: {
                  realName: {
                    contains: '13619654020',
                    mode: 'insensitive',
                  },
                },
              },
              {
                owner: {
                  email: {
                    contains: '13619654020',
                    mode: 'insensitive',
                  },
                },
              },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        contactPhone: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            email: true,
            name: true,
            realName: true,
          },
        },
      },
      orderBy: [{ id: 'asc' }],
    });
  });

  it('listAdminMembers 缺少 sub_account_quota 字段时回退旧档案查询', async () => {
    context.prismaService.storeMembershipProfile.findMany
      .mockResolvedValueOnce([{ storeId: 18 }])
      .mockRejectedValueOnce(
        new Error('column "sub_account_quota" does not exist'),
      )
      .mockResolvedValueOnce([
        {
          storeId: 18,
          currentPlanId: 'yearly',
          expiresAt: new Date('2027-11-09T02:22:50.155Z'),
          totalPoints: 2100,
          availablePoints: 2100,
        },
      ]);
    context.prismaService.store.findMany.mockResolvedValue([
      {
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
      },
    ]);
    context.prismaService.storeMembershipOrder.groupBy.mockResolvedValue([]);
    context.prismaService.storePartner.findMany.mockResolvedValue([]);
    context.redisService.getClient = jest.fn(() => ({
      mget: jest.fn().mockResolvedValue([null]),
    }));

    const result = await context.service.listAdminMembers(context.user, {});

    expect(context.prismaService.storeMembershipProfile.findMany).toHaveBeenNthCalledWith(
      2,
      {
        where: { storeId: { in: [18] } },
        select: {
          storeId: true,
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
          subAccountQuota: true,
        },
      },
    );
    expect(context.prismaService.storeMembershipProfile.findMany).toHaveBeenNthCalledWith(
      3,
      {
        where: { storeId: { in: [18] } },
        select: {
          storeId: true,
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      },
    );
    expect(result.items[0]).toMatchObject({
      id: '18',
      level: 'annual',
      subAccountQuota: 0,
      subAccountCapabilityEnabled: false,
    });
  });

  it('setAdminMemberMembership 支持设置为免费会员', async () => {
    jest
      .spyOn(
        context.adminService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(context.adminService as never, 'buildAdminMemberDetail' as never)
      .mockResolvedValue({
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
      } as never);

    const result = await context.service.setAdminMemberMembership(
      context.user,
      18,
      {
        level: 'free',
      },
    );

    expect(
      context.prismaService.storeMembershipProfile.upsert,
    ).toHaveBeenCalledWith({
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
    expect(
      context.cacheInvalidatorService.invalidatePulseDashboardHome,
    ).toHaveBeenCalledTimes(1);
  });

  it('setAdminMemberMembership 设置为 lifetime 时按配置有效期落盘', async () => {
    const fixedNow = new Date('2026-05-23T00:00:00.000Z');
    const expectedExpiry = new Date(
      fixedNow.getTime() + 730 * 24 * 60 * 60 * 1000,
    );
    jest.useFakeTimers().setSystemTime(fixedNow);
    jest
      .spyOn(
        context.adminService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(context.adminService as never, 'buildAdminMemberDetail' as never)
      .mockResolvedValue({
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
      } as never);
    context.platformMembershipService.getPlanConfig.mockResolvedValue({
      id: 'lifetime',
      name: '永久会员',
      price: 39800,
      originalPrice: null,
      durationMonths: null,
      validDays: 730,
    });

    try {
      const result = await context.service.setAdminMemberMembership(
        context.user,
        18,
        {
          level: 'lifetime',
        },
      );

      expect(
        context.platformMembershipService.getPlanConfig,
      ).toHaveBeenCalledWith('lifetime');
      expect(
        context.prismaService.storeMembershipProfile.upsert,
      ).toHaveBeenCalledWith({
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
      expect(
        context.cacheInvalidatorService.invalidatePulseDashboardHome,
      ).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('getAdminMemberDetail 返回平台会员详情', async () => {
    context.prismaService.store.findUnique.mockResolvedValue({
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
    context.prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'yearly',
      expiresAt: new Date('2027-11-09T02:22:50.155Z'),
      totalPoints: 2100,
      availablePoints: 2100,
    });
    context.prismaService.storeMembershipOrder.findMany.mockResolvedValue([
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
    context.prismaService.storePartner.findFirst.mockResolvedValue({
      beanBalance: 12,
      status: 'approved',
      totalEarnedBeans: 12,
      totalWithdrawnBeans: 0,
    });
    context.prismaService.storeMembershipPromoRecord.count.mockResolvedValue(2);

    const result = await context.service.getAdminMemberDetail(context.user, 18);

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
    context.prismaService.store.findUnique.mockResolvedValue({
      owner: {
        email: 'dev@example.com',
      },
    });

    await expect(
      context.service.getAdminMemberDetail(context.user, 101),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('banAdminMember 封号时会主动踢下线门店所有用户', async () => {
    jest
      .spyOn(
        context.adminService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(context.adminService as never, 'buildAdminMemberDetail' as never)
      .mockResolvedValue({
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
      } as never);

    context.prismaService.store.findUnique.mockResolvedValue({
      ownerId: 301,
      staffs: [{ userId: 302 }],
    });
    context.redisService.get
      .mockResolvedValueOnce('0')
      .mockResolvedValueOnce('1');
    context.redisService.set.mockResolvedValue(undefined);

    await context.service.banAdminMember(context.user, 18, {
      reason: '违规操作',
    });

    expect(context.redisService.set).toHaveBeenCalledWith(
      'pulse:membership:admin:member:18:ban-reason',
      '违规操作',
    );
    expect(context.redisService.set).toHaveBeenCalledWith(
      'auth:token-version:301',
      '1',
    );
    expect(context.redisService.set).toHaveBeenCalledWith(
      'auth:token-version:302',
      '2',
    );
  });

  it('banAdminMember 缺少封号原因时抛出 BadRequestException', async () => {
    jest
      .spyOn(
        context.adminService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);

    await expect(
      context.service.banAdminMember(context.user, 18, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(context.redisService.set).not.toHaveBeenCalled();
  });
});
