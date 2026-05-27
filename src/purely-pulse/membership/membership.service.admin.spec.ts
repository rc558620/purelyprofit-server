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

  it('listAdminMembers 将平台会员映射为 Pulse 会员列表', async () => {
    context.prismaService.storeMembershipProfile.findMany.mockResolvedValue([
      { storeId: 18 },
    ]);
    context.prismaService.store.findUnique.mockResolvedValue({
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
    context.prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'quarterly',
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
    ]);
    context.prismaService.storePartner.findFirst.mockResolvedValue(null);
    context.prismaService.storeMembershipPromoRecord.count.mockResolvedValue(0);

    const result = await context.service.listAdminMembers(context.user, {});

    expect(
      context.prismaService.storeMembershipProfile.findMany,
    ).toHaveBeenCalledWith({
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
    context.prismaService.storeMembershipProfile.findMany.mockResolvedValue([
      { storeId: 18 },
    ]);
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
      currentPlanId: null,
      expiresAt: null,
      totalPoints: 2100,
      availablePoints: 2100,
    });
    context.prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);
    context.prismaService.storePartner.findFirst.mockResolvedValue(null);
    context.prismaService.storeMembershipPromoRecord.count.mockResolvedValue(0);

    const result = await context.service.listAdminMembers(context.user, {});

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
