import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseGrowthAccessService } from './growth-access.service';
import { PulseGrowthAdminService } from './growth-admin.service';
import * as growthAdminDomain from './growth-admin.domain';
import * as growthAdminQuery from './growth-admin.query';
import { RedisService } from '../../redis/redis.service';
import { PulseGrowthEarningsService } from './growth-earnings.service';
import { PulseGrowthService } from './growth.service';

describe('PulseGrowthService', () => {
  let service: PulseGrowthService;

  const platformMembershipService = {
    getPromoCenterByStoreId: jest.fn(),
    getPartnerProfileByStoreId: jest.fn(),
  };

  const accessService = {
    resolveTargetStoreForGrowth: jest.fn(),
  };

  const adminService = {
    getAdminPromoDetail: jest.fn(),
    listAdminPartnerApplications: jest.fn(),
    approveAdminPartnerApplication: jest.fn(),
    rejectAdminPartnerApplication: jest.fn(),
    listAdminPayouts: jest.fn(),
    approveAdminPayout: jest.fn(),
    rejectAdminPayout: jest.fn(),
  };

  const earningsService = {
    getEarningsOverview: jest.fn(),
    getEarningsLogs: jest.fn(),
    getWithdrawalAccount: jest.fn(),
    updateWithdrawalAccount: jest.fn(),
    applyWithdrawal: jest.fn(),
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
        PulseGrowthService,
        {
          provide: PlatformMembershipService,
          useValue: platformMembershipService,
        },
        {
          provide: PulseGrowthAccessService,
          useValue: accessService,
        },
        {
          provide: PulseGrowthAdminService,
          useValue: adminService,
        },
        {
          provide: PulseGrowthEarningsService,
          useValue: earningsService,
        },
        {
          provide: RedisService,
          useValue: {
            getJson: jest.fn(),
            setJson: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PulseGrowthService>(PulseGrowthService);
  });

  it('getPromoCenter 通过显式 storeId 查看目标商家增长中心', async () => {
    accessService.resolveTargetStoreForGrowth.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: '0755-12345678',
      ownerId: 301,
      ownerName: '张三',
    });
    platformMembershipService.getPromoCenterByStoreId.mockResolvedValue({
      memberInfo: {
        isActive: true,
        planId: 'quarterly',
        expiredAt: new Date('2026-05-30T00:00:00.000Z').getTime(),
        inviteCode: 'PP-18',
        totalPoints: 300,
        availablePoints: 120,
      },
      approvedPartner: null,
      approvedPartners: [],
      level: {
        partnerLevel: null,
        monthChargedCount: 0,
        monthCountToNextLevel: null,
      },
      stats: {
        totalPromos: 0,
        chargedPromos: 0,
        promoRate: 0,
        earnedBeans: 0,
      },
      statsByPeriod: {
        all: { totalPromos: 0, chargedPromos: 0, promoRate: 0, earnedBeans: 0 },
        today: {
          totalPromos: 0,
          chargedPromos: 0,
          promoRate: 0,
          earnedBeans: 0,
        },
        month: {
          totalPromos: 0,
          chargedPromos: 0,
          promoRate: 0,
          earnedBeans: 0,
        },
        year: {
          totalPromos: 0,
          chargedPromos: 0,
          promoRate: 0,
          earnedBeans: 0,
        },
      },
      items: [],
    });

    const result = await service.getPromoCenter(user);

    expect(accessService.resolveTargetStoreForGrowth).toHaveBeenCalledWith(
      user,
      {
        notFoundMessage: '当前未选中目标商家门店，暂无法查看增长中心',
      },
    );
    expect(
      platformMembershipService.getPromoCenterByStoreId,
    ).toHaveBeenCalledWith(18);
    expect(result.items).toEqual([]);
  });

  it('applyPartner 在观察态下显式拒绝代商家发起申请', async () => {
    accessService.resolveTargetStoreForGrowth.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: '0755-12345678',
      ownerId: 301,
      ownerName: '张三',
    });

    await expect(
      service.applyPartner(user, {
        name: '张老板',
        phone: '13800138000',
        idCard: '440301199001011234',
        region: ['广东省', '深圳市', '南山区'],
        intention: 'resource',
        applyReason: '熟悉门店经营',
        paymentMethod: 'wechat',
        paymentAccount: 'wx_123',
      }),
    ).rejects.toThrow(
      new ForbiddenException(
        'Pulse 当前按开发者观察态运行，暂不支持代目标商家提交合伙人申请',
      ),
    );
  });
});

describe('PulseGrowthAdminService', () => {
  let service: PulseGrowthAdminService;

  const prismaService = {};
  const platformMembershipService = {
    approvePartnerApplication: jest.fn(),
    addPartnerFollowUpNote: jest.fn(),
    rejectPartnerApplication: jest.fn(),
  };
  const accessService = {
    buildAdminPayoutWhere: jest.fn(),
    buildPartnerApplicationWhere: jest.fn(),
    assertCanAccessAdminStore: jest.fn(),
    buildScopedUser: jest.fn(),
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
    jest.restoreAllMocks();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseGrowthAdminService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: PlatformMembershipService,
          useValue: platformMembershipService,
        },
        { provide: PulseGrowthAccessService, useValue: accessService },
      ],
    }).compile();

    service = module.get<PulseGrowthAdminService>(PulseGrowthAdminService);
  });

  it('listAdminPartnerApplications 将 tab 过滤和 cursor 下推到查询层', async () => {
    const where = { storeId: 18 };
    const applications = [];
    const stats = {
      pendingCount: 5,
      approvedCount: 3,
      rejectedCount: 2,
    };
    const mapped = {
      items: [],
      pendingCount: 5,
      approvedCount: 3,
      rejectedCount: 2,
      hasMore: false,
      nextCursor: null,
    };
    accessService.buildPartnerApplicationWhere.mockResolvedValue(where);
    const listSpy = jest
      .spyOn(growthAdminQuery, 'queryAdminPartnerApplications')
      .mockResolvedValue(applications as never);
    const statsSpy = jest
      .spyOn(growthAdminQuery, 'queryAdminPartnerApplicationStats')
      .mockResolvedValue(stats);
    const domainSpy = jest
      .spyOn(growthAdminDomain, 'buildAdminPartnerApplicationsResponse')
      .mockReturnValue(mapped as never);

    await expect(
      service.listAdminPartnerApplications(user, {
        tab: 'pending',
        cursor: '1747123200000_128',
        limit: 30,
      }),
    ).resolves.toEqual(mapped);

    expect(listSpy).toHaveBeenCalledWith(prismaService, {
      where,
      tab: 'pending',
      cursor: {
        createdAt: new Date('2025-05-13T08:00:00.000Z'),
        id: 128,
      },
      limit: 30,
    });
    expect(statsSpy).toHaveBeenCalledWith(prismaService, where);
    expect(domainSpy).toHaveBeenCalledWith({
      applications,
      stats,
      limit: 30,
    });
  });

  it('listAdminPartnerApplications cursor 非法时抛错', async () => {
    accessService.buildPartnerApplicationWhere.mockResolvedValue({
      storeId: 18,
    });

    await expect(
      service.listAdminPartnerApplications(user, {
        cursor: 'bad-cursor',
      }),
    ).rejects.toThrow('cursor 格式不合法');
  });

  it('buildAdminPartnerApplicationsResponse 在 cursor 模式下返回 nextCursor', () => {
    const result = growthAdminDomain.buildAdminPartnerApplicationsResponse({
      applications: [
        {
          id: 18,
          name: '张三',
          phone: '13800138000',
          region: ['广东省', '深圳市', '南山区'],
          applyReason: '我有稳定客户资源',
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          status: 'pending',
        },
        {
          id: 17,
          name: '李四',
          phone: '13900139000',
          region: ['上海市', '上海市'],
          applyReason: null,
          createdAt: new Date('2026-05-15T09:00:00.000Z'),
          status: 'approved',
        },
      ],
      stats: {
        pendingCount: 5,
        approvedCount: 3,
        rejectedCount: 2,
      },
      limit: 1,
    });

    expect(result).toEqual({
      items: [
        {
          id: '18',
          name: '张三',
          phone: '138****8000',
          city: '深圳市',
          appliedAt: '2026-05-15 18:00',
          reason: '我有稳定客户资源',
          avatar: '张',
          status: 'pending',
        },
      ],
      pendingCount: 5,
      approvedCount: 3,
      rejectedCount: 2,
      hasMore: true,
      nextCursor: `${new Date('2026-05-15T10:00:00.000Z').getTime()}_18`,
    });
  });

  it('listAdminPayouts 将 tab 过滤和 cursor 下推到查询层', async () => {
    const where = { storeId: 18 };
    const withdrawals = [];
    const stats = {
      pendingCount: 3,
      pendingTotal: 4300,
      paidTotal: 2000,
    };
    const mapped = {
      items: [],
      pendingCount: 3,
      pendingTotal: 4300,
      paidTotal: 2000,
      hasMore: false,
      nextCursor: null,
    };
    accessService.buildAdminPayoutWhere.mockResolvedValue(where);
    const listSpy = jest
      .spyOn(growthAdminQuery, 'queryAdminPayouts')
      .mockResolvedValue(withdrawals as never);
    const statsSpy = jest
      .spyOn(growthAdminQuery, 'queryAdminPayoutStats')
      .mockResolvedValue(stats);
    const domainSpy = jest
      .spyOn(growthAdminDomain, 'buildAdminPayoutsResponse')
      .mockReturnValue(mapped as never);

    await expect(
      service.listAdminPayouts(user, {
        tab: 'pending',
        cursor: '1747123200000_128',
        limit: 30,
      }),
    ).resolves.toEqual(mapped);

    expect(listSpy).toHaveBeenCalledWith(prismaService, {
      where,
      tab: 'pending',
      cursor: {
        appliedAt: new Date('2025-05-13T08:00:00.000Z'),
        id: 128,
      },
      limit: 30,
    });
    expect(statsSpy).toHaveBeenCalledWith(prismaService, where);
    expect(domainSpy).toHaveBeenCalledWith({
      withdrawals,
      stats,
      limit: 30,
    });
  });

  it('listAdminPayouts cursor 非法时抛错', async () => {
    accessService.buildAdminPayoutWhere.mockResolvedValue({ storeId: 18 });

    await expect(
      service.listAdminPayouts(user, {
        cursor: 'bad-cursor',
      }),
    ).rejects.toThrow('cursor 格式不合法');
  });

  it('buildAdminPayoutsResponse 在 cursor 模式下返回 nextCursor', () => {
    const result = growthAdminDomain.buildAdminPayoutsResponse({
      withdrawals: [
        {
          id: 18,
          rmbAmount: 2000,
          accountType: 'alipay',
          accountNo: '13800138000',
          accountName: '张三',
          status: 'pending',
          appliedAt: new Date('2026-05-15T10:00:00.000Z'),
          paidAt: null,
          rejectReason: null,
          partner: {
            name: '张三',
            phone: '13800138000',
            region: ['广东省', '深圳市', '南山区'],
          },
        },
        {
          id: 17,
          rmbAmount: 1500,
          accountType: 'wechat',
          accountNo: 'wx_123',
          accountName: '李四',
          status: 'paid',
          appliedAt: new Date('2026-05-15T09:00:00.000Z'),
          paidAt: new Date('2026-05-15T12:00:00.000Z'),
          rejectReason: null,
          partner: {
            name: '李四',
            phone: '13900139000',
            region: ['上海市', '上海市'],
          },
        },
      ],
      stats: {
        pendingCount: 3,
        pendingTotal: 4300,
        paidTotal: 2000,
      },
      limit: 1,
    });

    expect(result).toEqual({
      items: [
        {
          id: '18',
          partnerName: '张三',
          partnerPhone: '138****8000',
          partnerCity: '深圳市',
          amount: 2000,
          accountType: 'alipay',
          accountNo: '13800138000',
          accountName: '张三',
          status: 'pending',
          appliedAt: '2026-05-15 18:00',
          paidAt: null,
          txnNo: null,
          rejectReason: null,
        },
      ],
      pendingCount: 3,
      pendingTotal: 4300,
      paidTotal: 2000,
      hasMore: true,
      nextCursor: `${new Date('2026-05-15T10:00:00.000Z').getTime()}_18`,
    });
  });
});
