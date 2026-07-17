import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { PulseGrowthAccessService } from './growth-access.service';
import { PulseGrowthAdminPartnerApplicationService } from './growth-admin-partner-application.service';
import { PulseGrowthAdminPayoutService } from './growth-admin-payout.service';
import { PulseGrowthAdminQueryService } from './growth-admin-query.service';
import { PulseGrowthAdminService } from './growth-admin.service';
import * as growthAdminDomain from './growth-admin.domain';
import * as growthAdminQuery from './growth-admin.query';
import * as growthAdminPayoutQuery from './growth-admin-payout.query';
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
    lastActiveAt: null,
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

  it('admin.partnerApplications.list 按子域入口委托 admin service', async () => {
    const mapped = {
      items: [],
      pendingCount: 1,
      approvedCount: 2,
      rejectedCount: 3,
      hasMore: false,
      nextCursor: null,
    };
    adminService.listAdminPartnerApplications.mockResolvedValue(mapped);

    await expect(
      service.admin.partnerApplications.list(user, {
        tab: 'pending',
        limit: 20,
      }),
    ).resolves.toEqual(mapped);

    expect(adminService.listAdminPartnerApplications).toHaveBeenCalledWith(
      user,
      {
        tab: 'pending',
        limit: 20,
      },
    );
  });

  it('admin.payouts.reject 按子域入口委托 admin service', async () => {
    adminService.rejectAdminPayout.mockResolvedValue({ success: true });

    await expect(
      service.admin.payouts.reject(user, 28, { rejectReason: '资料不完整' }),
    ).resolves.toEqual({ success: true });

    expect(adminService.rejectAdminPayout).toHaveBeenCalledWith(user, 28, {
      rejectReason: '资料不完整',
    });
  });
});

describe('PulseGrowthAdminService', () => {
  let service: PulseGrowthAdminService;

  const queryService = {
    getAdminPromoDetail: jest.fn(),
    listAdminPartnerApplications: jest.fn(),
    listAdminPayouts: jest.fn(),
  };
  const partnerApplicationService = {
    approveAdminPartnerApplication: jest.fn(),
    rejectAdminPartnerApplication: jest.fn(),
  };
  const payoutService = {
    approveAdminPayout: jest.fn(),
    rejectAdminPayout: jest.fn(),
  };

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

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseGrowthAdminService,
        { provide: PulseGrowthAdminQueryService, useValue: queryService },
        {
          provide: PulseGrowthAdminPartnerApplicationService,
          useValue: partnerApplicationService,
        },
        { provide: PulseGrowthAdminPayoutService, useValue: payoutService },
      ],
    }).compile();

    service = module.get<PulseGrowthAdminService>(PulseGrowthAdminService);
  });

  it('listAdminPartnerApplications 委托给查询服务', async () => {
    const mapped = {
      items: [],
      pendingCount: 5,
      approvedCount: 3,
      rejectedCount: 2,
      hasMore: false,
      nextCursor: null,
    };
    queryService.listAdminPartnerApplications.mockResolvedValue(mapped);

    await expect(
      service.listAdminPartnerApplications(user, {
        tab: 'pending',
        cursor: '1747123200000_128',
        limit: 30,
      }),
    ).resolves.toEqual(mapped);

    expect(queryService.listAdminPartnerApplications).toHaveBeenCalledWith(
      user,
      {
        tab: 'pending',
        cursor: '1747123200000_128',
        limit: 30,
      },
    );
  });

  it('approveAdminPartnerApplication 委托给申请动作服务', async () => {
    partnerApplicationService.approveAdminPartnerApplication.mockResolvedValue({
      success: true,
    });

    await expect(
      service.approveAdminPartnerApplication(user, 18, { note: '通过' }),
    ).resolves.toEqual({ success: true });

    expect(
      partnerApplicationService.approveAdminPartnerApplication,
    ).toHaveBeenCalledWith(user, 18, { note: '通过' });
  });

  it('listAdminPayouts 委托给查询服务', async () => {
    const mapped = {
      items: [],
      pendingCount: 3,
      pendingTotal: 4300,
      paidTotal: 2000,
      hasMore: false,
      nextCursor: null,
    };
    queryService.listAdminPayouts.mockResolvedValue(mapped);

    await expect(
      service.listAdminPayouts(user, {
        tab: 'pending',
        cursor: '1747123200000_128',
        limit: 30,
      }),
    ).resolves.toEqual(mapped);

    expect(queryService.listAdminPayouts).toHaveBeenCalledWith(user, {
      tab: 'pending',
      cursor: '1747123200000_128',
      limit: 30,
    });
  });

  it('rejectAdminPayout 委托给打款动作服务', async () => {
    payoutService.rejectAdminPayout.mockResolvedValue({ success: true });

    await expect(
      service.rejectAdminPayout(user, 28, { rejectReason: '资料不完整' }),
    ).resolves.toEqual({ success: true });

    expect(payoutService.rejectAdminPayout).toHaveBeenCalledWith(user, 28, {
      rejectReason: '资料不完整',
    });
  });
});

describe('PulseGrowthAdminQueryService', () => {
  let service: PulseGrowthAdminQueryService;

  const prismaService = {};
  const refreshableCache = {
    getOrLoadRefreshableJson: jest.fn(
      async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
        loadValue(),
    ),
  };
  const accessService = {
    buildAdminStoreWhere: jest.fn(),
    buildAdminPayoutWhere: jest.fn(),
    buildPartnerApplicationWhere: jest.fn(),
  };

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

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    refreshableCache.getOrLoadRefreshableJson.mockImplementation(
      async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
        loadValue(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseGrowthAdminQueryService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RefreshableCacheService, useValue: refreshableCache },
        { provide: PulseGrowthAccessService, useValue: accessService },
      ],
    }).compile();

    service = module.get<PulseGrowthAdminQueryService>(
      PulseGrowthAdminQueryService,
    );
  });

  it('listAdminPartnerApplications 将 tab 过滤和 cursor 下推到查询层', async () => {
    const where = { storeId: 18 };
    const applications: Array<Record<string, unknown>> = [];
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
    expect(refreshableCache.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey:
          'pulse:growth:admin:partner-applications:mode:normal:scope:store%3A18:tab:pending:cursor:1747123200000_128:limit:30',
        ttlSeconds: 30,
      }),
    );
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

  it('listAdminPayouts 将 tab 过滤和 cursor 下推到查询层', async () => {
    const where = { storeId: 18 };
    const withdrawals: Array<Record<string, unknown>> = [];
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
      .spyOn(growthAdminPayoutQuery, 'queryAdminPayouts')
      .mockResolvedValue(withdrawals as never);
    const statsSpy = jest
      .spyOn(growthAdminPayoutQuery, 'queryAdminPayoutStats')
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
    expect(refreshableCache.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey:
          'pulse:growth:admin:payouts:mode:normal:scope:store%3A18:tab:pending:cursor:1747123200000_128:limit:30',
        ttlSeconds: 30,
      }),
    );
  });

  it('listAdminPayouts cursor 非法时抛错', async () => {
    accessService.buildAdminPayoutWhere.mockResolvedValue({ storeId: 18 });

    await expect(
      service.listAdminPayouts(user, {
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
          idCard: '440301199001011234',
          region: ['广东省', '深圳市', '南山区'],
          intention: 'agent',
          applyReason: '我有稳定客户资源',
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          status: 'pending',
        },
        {
          id: 17,
          name: '李四',
          phone: '13900139000',
          idCard: '310101199505051234',
          region: ['上海市', '上海市'],
          intention: 'resource',
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
          phone: '13800138000',
          idCard: '440301199001011234',
          city: '深圳市',
          appliedAt: '2026-05-15 18:00',
          reason: '我有稳定客户资源',
          avatar: '张',
          avatarUrl: undefined,
          intention: 'agent',
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
          partnerPhone: '13800138000',
          partnerCity: '深圳市',
          partnerAvatarUrl: undefined,
          amount: 2000,
          amountDisplay: '20.00',
          accountType: 'alipay',
          accountNo: '13800138000',
          accountName: '张三',
          status: 'pending',
          appliedAt: '2026-05-15 18:00',
          paidAt: null,
          rejectReason: null,
        },
      ],
      pendingCount: 3,
      pendingTotal: 4300,
      pendingTotalDisplay: '43.00',
      paidTotal: 2000,
      paidTotalDisplay: '20.00',
      hasMore: true,
      nextCursor: `${new Date('2026-05-15T10:00:00.000Z').getTime()}_18`,
    });
  });
});
