import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PulseMembershipAdminController } from './membership-admin.controller';
import { aValidDate } from '../../spec-matchers';
import {
  PulseAdminMemberMembershipDto,
  PulseAdminMemberSubAccountQuotaDto,
} from './dto/pulse-membership-admin-members.request.dto';
import {
  createPulseMembershipServiceTestingContext,
  type PulseMembershipServiceTestingContext,
} from './membership.service.test-setup';

describe('PulseAdminMemberSubAccountQuotaDto', () => {
  it('兼容旧请求的 memberId 与 subAccountQuota', async () => {
    const dto = plainToInstance(PulseAdminMemberSubAccountQuotaDto, {
      memberId: '48',
      subAccountQuota: 10,
    });

    await expect(
      validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).resolves.toEqual([]);
    expect(dto.memberId).toBe('48');
    expect(dto.subAccountQuota).toBe(10);
  });

  it('优先使用显式 quota 字段', async () => {
    const dto = plainToInstance(PulseAdminMemberSubAccountQuotaDto, {
      memberId: '48',
      quota: 6,
      subAccountQuota: 10,
    });

    await expect(
      validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).resolves.toEqual([]);
    expect(dto.quota).toBe(6);
  });
});

describe('PulseMembershipAdminController membership', () => {
  const user: AuthenticatedUser = {
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

  it('设置会员等级时透传 actionSource 与审计上下文', async () => {
    const pulseMembershipService = {
      setAdminMemberMembership: jest.fn().mockResolvedValue({ id: '48' }),
    };
    const controller = new PulseMembershipAdminController(
      pulseMembershipService as never,
    );

    await controller.setAdminMemberMembership(
      user,
      '48',
      plainToInstance(PulseAdminMemberMembershipDto, {
        memberId: '48',
        level: 'free',
        confirmDowngradeToFree: true,
        actionSource: 'member-detail-membership-modal',
      }),
      {
        requestId: 'req-001',
        userAgent: 'jest-agent',
        ip: '127.0.0.1',
      },
    );

    expect(
      pulseMembershipService.setAdminMemberMembership,
    ).toHaveBeenCalledWith(
      user,
      48,
      expect.objectContaining({
        level: 'free',
        confirmDowngradeToFree: true,
        actionSource: 'member-detail-membership-modal',
        auditContext: {
          requestId: 'req-001',
          userAgent: 'jest-agent',
          ip: '127.0.0.1',
        },
      }),
    );
  });
});

describe('PulseMembershipAdminController sub-account quota', () => {
  const user: AuthenticatedUser = {
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

  it('将旧请求字段 subAccountQuota 归一化后透传给 service', async () => {
    const pulseMembershipService = {
      updateAdminMemberSubAccountQuota: jest
        .fn()
        .mockResolvedValue({ id: '48' }),
    };
    const controller = new PulseMembershipAdminController(
      pulseMembershipService as never,
    );

    await controller.updateAdminMemberSubAccountQuota(
      user,
      '48',
      plainToInstance(PulseAdminMemberSubAccountQuotaDto, {
        memberId: '48',
        subAccountQuota: 10,
      }),
    );

    expect(
      pulseMembershipService.updateAdminMemberSubAccountQuota,
    ).toHaveBeenCalledWith(user, 48, {
      quota: 10,
      reason: undefined,
      roleSummary: undefined,
    });
  });
});

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
        changeType: 'increase',
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
            avatar: null,
            lastActiveAt: null,
          },
        },
      },
      {
        id: 20,
        storeId: 18,
        source: 'expire',
        changeType: 'decrease',
        changeAmount: 30,
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
            avatar: null,
            lastActiveAt: null,
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
        changeType: true,
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
                avatar: true,
                email: true,
                name: true,
                realName: true,
                wechatPhone: true,
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
          userPhone: '13619654020',
          avatarUrl: undefined,
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
            avatar: null,
            lastActiveAt: null,
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
            avatar: null,
            lastActiveAt: null,
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
                avatar: true,
                email: true,
                name: true,
                realName: true,
                wechatPhone: true,
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
          userPhone: '13619654020',
          avatarUrl: undefined,
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
          avatar: null,
          lastActiveAt: null,
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
          deletedAt: null,
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
        AND: [{ id: { in: [18] } }, { deletedAt: null }],
      },
      select: {
        id: true,
        name: true,
        contactPhone: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        owner: {
          select: {
            email: true,
            name: true,
            realName: true,
            avatar: true,
            wechatPhone: true,
            lastActiveAt: true,
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

  it('listAdminMembers 按账号最近鉴权时间标记在线，离线与无记录都为 false', async () => {
    context.prismaService.storeMembershipProfile.findMany
      .mockResolvedValueOnce([{ storeId: 18 }, { storeId: 19 }, { storeId: 20 }])
      .mockResolvedValueOnce([
        {
          storeId: 18,
          currentPlanId: 'yearly',
          expiresAt: new Date('2027-11-09T02:22:50.155Z'),
          totalPoints: 0,
          availablePoints: 0,
        },
        {
          storeId: 19,
          currentPlanId: 'yearly',
          expiresAt: new Date('2027-11-09T02:22:50.155Z'),
          totalPoints: 0,
          availablePoints: 0,
        },
        {
          storeId: 20,
          currentPlanId: 'yearly',
          expiresAt: new Date('2027-11-09T02:22:50.155Z'),
          totalPoints: 0,
          availablePoints: 0,
        },
      ]);
    const buildOwner = (lastActiveAt: Date | null) => ({
      email: 'phone_13619654020@purelyprofit.local',
      name: null,
      realName: '张三',
      avatar: null,
      lastActiveAt,
    });
    context.prismaService.store.findMany.mockResolvedValue([
      {
        id: 18,
        name: '刚活跃门店',
        contactPhone: null,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-21T00:00:00.000Z'),
        owner: buildOwner(new Date(Date.now() - 3 * 60 * 1000)),
      },
      {
        id: 19,
        name: '离线门店',
        contactPhone: null,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-21T00:00:00.000Z'),
        owner: buildOwner(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)),
      },
      {
        id: 20,
        name: '无活跃记录门店',
        contactPhone: null,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-21T00:00:00.000Z'),
        owner: buildOwner(null),
      },
    ]);
    context.prismaService.storeMembershipOrder.groupBy.mockResolvedValue([]);
    context.prismaService.storePartner.findMany.mockResolvedValue([]);
    context.redisService.getClient = jest.fn(() => ({
      mget: jest.fn().mockResolvedValue([null]),
    }));

    const result = await context.service.listAdminMembers(context.user, {});

    expect(
      result.items.map((item) => [item.id, item.isOnline]),
    ).toEqual([
      ['18', true],
      ['19', false],
      ['20', false],
    ]);
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
          avatar: null,
          lastActiveAt: null,
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
          { deletedAt: null },
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
                expiresAt: { gt: aValidDate },
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
        deletedAt: true,
        owner: {
          select: {
            avatar: true,
            email: true,
            name: true,
            realName: true,
            wechatPhone: true,
            lastActiveAt: true,
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
          avatar: null,
          lastActiveAt: null,
        },
      },
    ]);
    context.prismaService.storeMembershipOrder.groupBy.mockResolvedValue([]);
    context.prismaService.storePartner.findMany.mockResolvedValue([]);
    context.redisService.getClient = jest.fn(() => ({
      mget: jest.fn().mockResolvedValue([null]),
    }));

    const result = await context.service.listAdminMembers(context.user, {});

    expect(
      context.prismaService.storeMembershipProfile.findMany,
    ).toHaveBeenNthCalledWith(2, {
      where: { storeId: { in: [18] } },
      select: {
        storeId: true,
        currentPlanId: true,
        previousPlanId: true,
        startsAt: true,
        expiresAt: true,
        totalPoints: true,
        availablePoints: true,
        subAccountQuota: true,
        pulseSubAccountQuota: true,
      },
    });
    expect(
      context.prismaService.storeMembershipProfile.findMany,
    ).toHaveBeenNthCalledWith(3, {
      where: { storeId: { in: [18] } },
      select: {
        storeId: true,
        currentPlanId: true,
        previousPlanId: true,
        startsAt: true,
        expiresAt: true,
        totalPoints: true,
        availablePoints: true,
      },
    });
    expect(result.items[0]).toMatchObject({
      id: '18',
      level: 'annual',
      subAccountQuota: 0,
      subAccountCapabilityEnabled: false,
    });
  });

  it('setAdminMemberMembership 支持显式确认后设置为免费会员', async () => {
    const loggerWarnSpy = jest
      .spyOn(context.mutationService['logger'], 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn(
        context.mutationService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        context.memberReadService as never,
        'findMembershipProfileByStoreId' as never,
      )
      .mockResolvedValue({
        currentPlanId: 'quarterly',
        expiresAt: new Date('2099-05-21T00:00:00.000Z'),
        totalPoints: 320,
        availablePoints: 260,
        subAccountQuota: 0,
      } as never);
    jest
      .spyOn(
        context.memberReadService as never,
        'buildAdminMemberDetail' as never,
      )
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
        availablePoints: 260,
        totalPointsEarned: 320,
        beanBalance: 0,
        isPartner: false,
        totalRecharged: 0,
        rechargeCount: 0,
        invitedCount: 0,
        rechargeHistory: [],
        membershipExpiry: null,
      } as never);
    context.prismaService.store.findUnique.mockResolvedValue({
      id: 18,
      ownerId: 301,
      staffs: [],
    });
    context.prismaService.storePartner.findFirst.mockResolvedValue(null);

    const result = await context.service.setAdminMemberMembership(
      context.user,
      18,
      {
        level: 'free',
        confirmDowngradeToFree: true,
        actionSource: 'member-detail-membership-modal',
        auditContext: {
          requestId: 'req-001',
          userAgent: 'jest-agent',
          ip: '127.0.0.1',
        },
      },
    );

    expect(
      context.prismaService.storeMembershipProfile.upsert,
    ).toHaveBeenCalledWith({
      where: { storeId: 18 },
      create: {
        storeId: 18,
        currentPlanId: null,
        // 降级为免费时把原档位转存下来：currentPlanId 被清空后，续费页只能靠它
        // 判断原档位，否则永久会员会丢掉 AGES 续费入口
        previousPlanId: 'quarterly',
        // 降级为免费也保留 startsAt，标记档案已被显式管理，防止订单重建逻辑恢复付费会员
        startsAt: expect.any(Date),
        expiresAt: null,
        totalPoints: 320,
        availablePoints: 260,
      },
      update: {
        currentPlanId: null,
        previousPlanId: 'quarterly',
        startsAt: expect.any(Date),
        expiresAt: null,
      },
    });
    expect(result.level).toBe('free');
    expect(result.membershipExpiry).toBeNull();
    expect(
      context.cacheInvalidatorService.invalidatePulseDashboardHome,
    ).toHaveBeenCalledTimes(1);
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pulse_admin_membership_level_mutation'),
    );
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('member-detail-membership-modal'),
    );
  });

  it('setAdminMemberMembership 未显式确认时拒绝把有效会员降级为免费会员', async () => {
    jest
      .spyOn(
        context.mutationService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        context.memberReadService as never,
        'findMembershipProfileByStoreId' as never,
      )
      .mockResolvedValue({
        currentPlanId: 'monthly',
        expiresAt: new Date('2099-05-21T00:00:00.000Z'),
        totalPoints: 120,
        availablePoints: 80,
        subAccountQuota: 0,
      } as never);
    context.prismaService.store.findUnique.mockResolvedValue({ id: 18 });
    context.prismaService.storePartner.findFirst.mockResolvedValue(null);

    await expect(
      context.service.setAdminMemberMembership(context.user, 18, {
        level: 'free',
      }),
    ).rejects.toThrow('当前会员仍在有效期内，降级到免费会员需要显式确认');
    expect(
      context.prismaService.storeMembershipProfile.upsert,
    ).not.toHaveBeenCalled();
  });

  it('setAdminMemberMembership 设置为 lifetime 时按配置有效期落盘', async () => {
    const fixedNow = new Date('2026-05-23T00:00:00.000Z');
    const expectedExpiry = new Date(
      fixedNow.getTime() + 730 * 24 * 60 * 60 * 1000,
    );
    jest.useFakeTimers().setSystemTime(fixedNow);
    jest
      .spyOn(
        context.mutationService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        context.memberReadService as never,
        'findMembershipProfileByStoreId' as never,
      )
      .mockResolvedValue({
        currentPlanId: null,
        expiresAt: null,
        totalPoints: 0,
        availablePoints: 0,
        subAccountQuota: 0,
      } as never);
    jest
      .spyOn(
        context.memberReadService as never,
        'buildAdminMemberDetail' as never,
      )
      .mockResolvedValue({
        id: '18',
        name: '张三',
        phone: '13619654020',
        avatarChar: '张',
        avatarColorIdx: 0,
        avatarUrl: '',
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
    context.prismaService.store.findUnique.mockResolvedValue({
      id: 18,
      ownerId: 301,
      staffs: [],
    });
    context.prismaService.storePartner.findFirst.mockResolvedValue(null);
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
          // 设置付费档位时清空原档位：currentPlanId 本身就是续费依据
          previousPlanId: null,
          startsAt: fixedNow,
          expiresAt: expectedExpiry,
          totalPoints: 0,
          availablePoints: 0,
        },
        update: {
          currentPlanId: 'lifetime',
          previousPlanId: null,
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

  /** 桩掉「设置会员等级」链路上与本组用例无关的读取与审计依赖 */
  const stubMembershipMutationDependencies = (): void => {
    jest
      .spyOn(
        context.mutationService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        context.memberReadService as never,
        'findMembershipProfileByStoreId' as never,
      )
      .mockResolvedValue({
        currentPlanId: null,
        previousPlanId: null,
        startsAt: null,
        expiresAt: null,
        totalPoints: 0,
        availablePoints: 0,
        subAccountQuota: 0,
      } as never);
    jest
      .spyOn(
        context.memberReadService as never,
        'buildAdminMemberDetail' as never,
      )
      .mockResolvedValue({ id: '18', level: 'annual' } as never);
    context.prismaService.store.findUnique.mockResolvedValue({
      id: 18,
      ownerId: 301,
      staffs: [],
    });
    context.prismaService.storePartner.findFirst.mockResolvedValue(null);
  };

  it('setAdminMemberMembership 带成交价时按元转分写入首购锁定价（source=admin）', async () => {
    stubMembershipMutationDependencies();

    await context.service.setAdminMemberMembership(context.user, 18, {
      level: 'annual',
      membershipExpiry: new Date('2027-05-21T00:00:00.000Z').getTime(),
      priceDisplay: '598',
    });

    expect(
      context.prismaService.storeMembershipLockedPrice.createMany,
    ).toHaveBeenCalledWith({
      data: [{ storeId: 18, planId: 'yearly', price: 59800, source: 'admin' }],
      skipDuplicates: true,
    });
  });

  it('setAdminMemberMembership 锁定价已存在时不覆盖（skipDuplicates 命中重复）', async () => {
    stubMembershipMutationDependencies();
    context.prismaService.storeMembershipLockedPrice.createMany.mockResolvedValue(
      { count: 0 },
    );

    await expect(
      context.service.setAdminMemberMembership(context.user, 18, {
        level: 'annual',
        membershipExpiry: new Date('2027-05-21T00:00:00.000Z').getTime(),
        priceDisplay: '369',
      }),
    ).resolves.toBeDefined();

    // 第二次成交仍以 skipDuplicates 写入，由唯一键保证保留首次锁定价
    expect(
      context.prismaService.storeMembershipLockedPrice.createMany,
    ).toHaveBeenCalledWith({
      data: [{ storeId: 18, planId: 'yearly', price: 36900, source: 'admin' }],
      skipDuplicates: true,
    });
  });

  it('setAdminMemberMembership 未开通子账号功能时不写入首购锁定价', async () => {
    stubMembershipMutationDependencies();
    // 从未开通子账号功能：快照写入后读侧永不生效，却会在门店日后开通子账号
    // （pulseSubAccountQuota 由 0 变正）时突然生效，所以宁可不写
    context.platformMembershipAccessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      {
        level: 'yearly',
        eligible: true,
        quota: 0,
        quotaMax: 10,
        enabled: false,
        rawQuota: 0,
        featureOwned: false,
        previousLevel: 'yearly',
      },
    );

    await context.service.setAdminMemberMembership(context.user, 18, {
      level: 'annual',
      membershipExpiry: new Date('2027-05-21T00:00:00.000Z').getTime(),
      priceDisplay: '598',
    });

    expect(
      context.prismaService.storeMembershipLockedPrice.createMany,
    ).not.toHaveBeenCalled();
  });

  it('setAdminMemberMembership 未带成交价 / 成交价非法时不写入锁定价', async () => {
    stubMembershipMutationDependencies();
    const expireAt = new Date('2027-05-21T00:00:00.000Z').getTime();

    await context.service.setAdminMemberMembership(context.user, 18, {
      level: 'annual',
      membershipExpiry: expireAt,
    });
    await context.service.setAdminMemberMembership(context.user, 18, {
      level: 'annual',
      membershipExpiry: expireAt,
      priceDisplay: '0',
    });
    await context.service.setAdminMemberMembership(context.user, 18, {
      level: 'annual',
      membershipExpiry: expireAt,
      priceDisplay: 'abc',
    });

    expect(
      context.prismaService.storeMembershipLockedPrice.createMany,
    ).not.toHaveBeenCalled();
  });

  /** 桩出门店详情的读取依赖；ownerLastActiveAt 用于验证在线判定 */
  const stubMemberDetailStore = (
    ownerLastActiveAt: Date | null,
    storeOverrides: Record<string, unknown> = {},
  ): void => {
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
        avatar: null,
        wechatPhone: null,
        lastActiveAt: ownerLastActiveAt,
      },
      ...storeOverrides,
    });
    context.prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'yearly',
      expiresAt: new Date('2027-11-09T02:22:50.155Z'),
      totalPoints: 0,
      availablePoints: 0,
    });
    context.prismaService.storeMembershipPromoRecord.count.mockResolvedValue(0);
  };

  it('getAdminMemberDetail 最近 10 分钟内有鉴权请求时 isOnline=true', async () => {
    stubMemberDetailStore(new Date(Date.now() - 5 * 60 * 1000));
    context.prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);

    const result = await context.service.getAdminMemberDetail(context.user, 18);

    expect(result.isOnline).toBe(true);
  });

  it('getAdminMemberDetail 离线账号 isOnline=false，且刚充过值不会误判为在线', async () => {
    // 关键反例：lastActiveAt 为空但最近有充值订单 —— 充值时间只用于「活跃」展示兜底，
    // 不能作为在线依据
    stubMemberDetailStore(null);
    const recentOrderAt = new Date(Date.now() - 60 * 1000);
    context.prismaService.storeMembershipOrder.findMany.mockResolvedValue([
      {
        id: 9,
        planId: 'yearly',
        planName: '年度会员',
        amount: 36900,
        createdAt: recentOrderAt,
      },
    ]);

    const result = await context.service.getAdminMemberDetail(context.user, 18);

    expect(result.isOnline).toBe(false);
    // 展示用的「活跃」仍会兜底到最近充值时间，与在线状态解耦
    expect(result.lastActiveAt).toBe(recentOrderAt.getTime());
  });

  it('getAdminMemberDetail 三天前活跃的账号 isOnline=false', async () => {
    stubMemberDetailStore(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    context.prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);

    const result = await context.service.getAdminMemberDetail(context.user, 18);

    expect(result.isOnline).toBe(false);
  });

  it('resetAdminMemberLockedPrices 清空门店锁定价并写审计日志', async () => {
    const loggerWarnSpy = jest
      .spyOn(context.mutationService['logger'], 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn(
        context.mutationService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        context.memberReadService as never,
        'buildAdminMemberDetail' as never,
      )
      .mockResolvedValue({ id: '18', level: 'annual' } as never);
    context.prismaService.storeMembershipLockedPrice.deleteMany.mockResolvedValue(
      { count: 2 },
    );

    const result = await context.service.resetAdminMemberLockedPrices(
      context.user,
      18,
    );

    expect(
      context.prismaService.storeMembershipLockedPrice.deleteMany,
    ).toHaveBeenCalledWith({ where: { storeId: 18 } });
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pulse_admin_membership_locked_price_reset'),
    );
    expect(result.id).toBe('18');
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
        avatar: null,
        lastActiveAt: null,
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
    context.prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue(
      [
        {
          planId: 'lifetime',
          price: 59800,
          source: 'admin',
          lockedAt: new Date('2026-05-20T00:00:00.000Z'),
        },
        {
          planId: 'yearly',
          price: 58800,
          source: 'purchase',
          lockedAt: new Date('2026-05-21T00:00:00.000Z'),
        },
      ],
    );

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
    // 首购锁定价快照：元 / 分双口径 + 来源 + 锁定时点，供运营直接查看
    expect(result.lockedPrices).toEqual([
      {
        planId: 'lifetime',
        price: 59800,
        priceDisplay: '598',
        source: 'admin',
        lockedAt: new Date('2026-05-20T00:00:00.000Z').getTime(),
      },
      {
        planId: 'yearly',
        price: 58800,
        priceDisplay: '588',
        source: 'purchase',
        lockedAt: new Date('2026-05-21T00:00:00.000Z').getTime(),
      },
    ]);
  });

  it('getAdminMemberDetail 未锁价时返回空数组（而不是字段缺失）', async () => {
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
        avatar: null,
        lastActiveAt: null,
      },
    });
    context.prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'monthly',
      expiresAt: new Date('2026-06-21T00:00:00.000Z'),
      totalPoints: 0,
      availablePoints: 0,
    });
    context.prismaService.storeMembershipPromoRecord.count.mockResolvedValue(0);
    context.prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);

    const result = await context.service.getAdminMemberDetail(context.user, 18);

    expect(result.lockedPrices).toEqual([]);
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
        context.mutationService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        context.memberReadService as never,
        'buildAdminMemberDetail' as never,
      )
      .mockResolvedValue({
        id: '18',
        name: '张三',
        phone: '13619654020',
        avatarChar: '张',
        avatarColorIdx: 0,
        avatarUrl: '',
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
    // bumpTokenVersionBatch 使用 mgetJson 批量读取 token version
    context.redisService.mgetJson.mockResolvedValue(['0', '1']);
    // bumpTokenVersionBatch 使用 pipeline 批量设置 token version
    const mockPipeline = {
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(undefined),
    };
    context.redisService.getClient.mockReturnValue({
      pipeline: () => mockPipeline,
    });
    context.redisService.set.mockResolvedValue(undefined);

    await context.service.banAdminMember(context.user, 18, {
      reason: '违规操作',
    });

    expect(context.redisService.set).toHaveBeenCalledWith(
      'pulse:membership:admin:member:18:ban-reason',
      '违规操作',
      30 * 24 * 60 * 60,
    );
    // 验证 pipeline.set 被调用两次（userId 301 和 302）
    expect(mockPipeline.set).toHaveBeenCalledWith(
      'auth:token-version:301',
      '1',
      'EX',
      7 * 24 * 60 * 60,
    );
    expect(mockPipeline.set).toHaveBeenCalledWith(
      'auth:token-version:302',
      '2',
      'EX',
      7 * 24 * 60 * 60,
    );
    // 封禁必须吊销 refresh token 与会话，防止客户端静默续签重新上线
    expect(context.authSessionService.removeAllSessions).toHaveBeenCalledWith(
      301,
    );
    expect(context.authSessionService.removeAllSessions).toHaveBeenCalledWith(
      302,
    );
    // 同步清除鉴权链路缓存，避免缓存 TTL 内旧会员行放行
    expect(context.redisService.delByPattern).toHaveBeenCalledWith(
      'auth:membership-rows:301:*',
    );
    expect(context.redisService.del).toHaveBeenCalledWith(
      'auth:user-related-stores:301',
    );
  });

  it('cancelAdminMember 注销时软删除并立即踢下线门店所有用户', async () => {
    const loggerWarnSpy = jest
      .spyOn(context.mutationService['logger'], 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn(
        context.mutationService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        context.memberReadService as never,
        'buildAdminMemberDetail' as never,
      )
      .mockResolvedValue({
        id: '18',
        name: '张三',
        phone: '13619654020',
        avatarChar: '张',
        avatarColorIdx: 0,
        avatarUrl: '',
        status: 'cancelled',
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
    context.prismaService.store.update.mockResolvedValue({});
    context.prismaService.store.findUnique.mockResolvedValue({
      ownerId: 301,
      staffs: [{ userId: 302 }],
    });
    // owner 无其他在营门店 → 释放登录身份
    context.prismaService.store.count.mockResolvedValue(0);
    context.prismaService.staff.updateMany.mockResolvedValue({ count: 2 });
    context.prismaService.user.update.mockResolvedValue({});
    context.redisService.mgetJson.mockResolvedValue(['0', '1']);
    const mockPipeline = {
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(undefined),
    };
    context.redisService.getClient.mockReturnValue({
      pipeline: () => mockPipeline,
    });

    await context.service.cancelAdminMember(context.user, 18);

    expect(context.prismaService.store.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 18 },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    // 注销后释放登录身份：员工行停用且 email/phone/login_account 改写为占位值，
    // 绕过单账号单门店唯一索引与触发器，owner 唯一登录邮箱改写后手机号可重新注册
    const rawUpdate = context.prismaService.$executeRaw.mock.calls[0]?.[0];
    expect(rawUpdate).toBeDefined();
    expect(String(rawUpdate.text ?? rawUpdate)).toContain('UPDATE "staffs"');
    expect(context.prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 301 },
      data: {
        email: expect.stringMatching(
          /^cancelled_u301_\d+@purelyprofit\.invalid$/,
        ),
        wechatPhone: null,
      },
    });
    expect(context.prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 301 },
      data: {
        email: expect.stringMatching(
          /^cancelled_u301_\d+@purelyprofit\.invalid$/,
        ),
        wechatPhone: null,
      },
    });
    // 注销必须立即踢下线：bump token version + 吊销 refresh token 与会话
    expect(context.authSessionService.removeAllSessions).toHaveBeenCalledWith(
      301,
    );
    expect(context.authSessionService.removeAllSessions).toHaveBeenCalledWith(
      302,
    );
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pulse_admin_member_cancel'),
    );
  });

  it('banAdminMember 缺少封号原因时抛出 BadRequestException', async () => {
    jest
      .spyOn(
        context.mutationService as never,
        'assertAdminMemberMutationAccess' as never,
      )
      .mockResolvedValue(undefined as never);

    await expect(
      context.service.banAdminMember(context.user, 18, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(context.redisService.set).not.toHaveBeenCalled();
  });
});
