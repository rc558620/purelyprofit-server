import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisService } from '../../../redis/redis.service';
import { PlatformMembershipLedgerService } from './platform-membership-ledger.service';
import { PlatformMembershipOrderService } from './platform-membership-order.service';
import { PlatformMembershipPartnerService } from './platform-membership-partner.service';
import { PlatformMembershipReadService } from './platform-membership-read.service';
import { PlatformMembershipService } from './platform-membership.service';

describe('PlatformMembershipService', () => {
  let service: PlatformMembershipService;

  const prismaService = {
    store: {
      findFirst: jest.fn(),
    },
    storePartner: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    storePartnerApplication: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    storePartnerApplicationNote: {
      create: jest.fn(),
    },
    storePartnerBeanLog: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
    storeMembershipProfile: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    membershipPlanSetting: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    storeMembershipOrder: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    storeMembershipPointsLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    storeMembershipPromoRecord: {
      findMany: jest.fn(),
    },
    storeInviteCode: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidatePulseDashboardHome: jest.fn(),
    invalidateMembershipDerived: jest.fn(),
  };

  const redisService = {
    getOrLoadRefreshableJson: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
    mgetJson: jest.fn(),
    delByPattern: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'owner',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  const expectAgesPurchaseKeepsMaskedPlan = async ({
    planId,
    planName,
    durationDays,
    orderId,
    amount,
    paymentOrderId,
    bonusPoints,
  }: {
    planId: 'monthly' | 'quarterly' | 'yearly';
    planName: string;
    durationDays: number;
    orderId: number;
    amount: number;
    paymentOrderId: string;
    bonusPoints: number;
  }) => {
    const agesStartAt = new Date('2099-01-01T00:00:00.000Z');
    const nextAgesStartAt = new Date(
      agesStartAt.getTime() + durationDays * 24 * 60 * 60 * 1000,
    );
    const nextDisplayExpiry = new Date(
      agesStartAt.getTime() + (730 + durationDays) * 24 * 60 * 60 * 1000,
    );
    const createdAt = new Date('2099-02-01T00:00:00.000Z');

    prismaService.store.findFirst.mockResolvedValue({ id: 18 });
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'yearly',
      startsAt: agesStartAt,
      expiresAt: null,
      totalPoints: 0,
      availablePoints: 0,
    });
    prismaService.storePartner.findUnique.mockResolvedValue(null);
    prismaService.storeMembershipProfile.update.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'yearly',
      startsAt: nextAgesStartAt,
      expiresAt: null,
      totalPoints: bonusPoints,
      availablePoints: bonusPoints,
    });
    prismaService.storeMembershipOrder.create.mockResolvedValue({
      id: orderId,
      planId,
      planName,
      amount,
      pointsUsed: 0,
      beansUsed: 0,
      status: 'paid',
      paymentChannel: 'wechat',
      paymentOrderId,
      createdAt,
    });
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([
      {
        id: orderId,
        planId,
        planName,
        amount,
        pointsUsed: 0,
        beansUsed: 0,
        status: 'paid',
        paymentChannel: 'wechat',
        paymentOrderId,
        createdAt,
      },
    ]);

    const result = await service.purchaseOrder(user, { planId });

    expect(prismaService.storeMembershipProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentPlanId: 'yearly',
          startsAt: nextAgesStartAt,
          expiresAt: null,
          totalPoints: bonusPoints,
          availablePoints: bonusPoints,
        }),
      }),
    );
    expect(result.profile.memberInfo).toMatchObject({
      isActive: true,
      planId: 'yearly',
      displayPlanName: 'ages会员',
      expiredAt: nextDisplayExpiry.getTime(),
      totalPoints: bonusPoints,
      availablePoints: bonusPoints,
    });
    expect(result.order.planId).toBe(planId);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.storePartner.findFirst.mockImplementation(
      (...args: unknown[]) => prismaService.storePartner.findUnique(...args),
    );
    prismaService.storePartner.findMany.mockImplementation(async () => {
      const partner = await prismaService.storePartner.findFirst();
      return partner ? [partner] : [];
    });
    prismaService.storePartnerApplication.findMany.mockResolvedValue([]);
    prismaService.storePartnerApplicationNote.create.mockResolvedValue({
      id: 1,
    });
    prismaService.storePartner.upsert.mockResolvedValue({ id: 11 });
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);
    redisService.getOrLoadRefreshableJson.mockImplementation(
      async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
        loadValue(),
    );
    prismaService.membershipPlanSetting.findMany.mockResolvedValue([
      {
        planId: 'monthly',
        planName: '月度会员',
        price: 3800,
        originalPrice: 3800,
        durationMonths: 1,
        validDays: null,
        updatedAt: new Date('2026-05-21T00:00:00.000Z'),
      },
      {
        planId: 'quarterly',
        planName: '季度会员',
        price: 9900,
        originalPrice: 11400,
        durationMonths: 3,
        validDays: null,
        updatedAt: new Date('2026-05-21T00:00:01.000Z'),
      },
      {
        planId: 'yearly',
        planName: '年度会员',
        price: 36900,
        originalPrice: 45600,
        durationMonths: 12,
        validDays: null,
        updatedAt: new Date('2026-05-21T00:00:02.000Z'),
      },
      {
        planId: 'lifetime',
        planName: '永久会员',
        price: 39800,
        originalPrice: null,
        durationMonths: null,
        validDays: 730,
        updatedAt: new Date('2026-05-21T00:00:03.000Z'),
      },
    ]);
    prismaService.storeInviteCode.findFirst.mockResolvedValue({
      code: 'TEST1234',
    });
    prismaService.$transaction.mockImplementation(
      async (
        callback: (transactionClient: typeof prismaService) => Promise<unknown>,
      ) => callback(prismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformMembershipService,
        PlatformMembershipReadService,
        PlatformMembershipLedgerService,
        PlatformMembershipPartnerService,
        PlatformMembershipOrderService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
      ],
    }).compile();

    service = module.get<PlatformMembershipService>(PlatformMembershipService);
  });

  it.each([
    'getCenter',
    'getProfile',
    'listOrders',
    'purchaseOrder',
    'listPointsLogs',
    'listBeanLogs',
    'getPromoCenter',
    'getPromotionDetailCompat',
    'getPartnerProfile',
    'applyPartner',
    'markPartnerApplicationReviewing',
    'approvePartnerApplication',
    'rejectPartnerApplication',
    'cancelPartnerApplication',
    'addPartnerFollowUpNote',
  ] as const)(
    '子账号访问会员中心 service %s 时仍会被拒绝',
    async (methodName) => {
      const subAccountUser: AuthenticatedUser = {
        ...user,
        currentMembership: {
          ...user.currentMembership!,
          subjectType: 'sub_account',
          role: 'staff',
          permissions: ['partner:view'],
          subAccountId: 3,
          subAccountRole: 'manager',
          subAccountStatus: 'active',
          subAccountAssigned: true,
          linkedEmployeeId: 12,
        },
      };

      const invocations: Record<string, () => Promise<unknown>> = {
        getCenter: () => service.getCenter(subAccountUser),
        getProfile: () => service.getProfile(subAccountUser),
        listOrders: () => service.listOrders(subAccountUser),
        purchaseOrder: () =>
          service.purchaseOrder(subAccountUser, { planId: 'monthly' }),
        listPointsLogs: () => service.listPointsLogs(subAccountUser),
        listBeanLogs: () => service.listBeanLogs(subAccountUser),
        getPromoCenter: () => service.getPromoCenter(subAccountUser),
        getPromotionDetailCompat: () =>
          service.getPromotionDetailCompat(subAccountUser, {}),
        getPartnerProfile: () => service.getPartnerProfile(subAccountUser),
        applyPartner: () =>
          service.applyPartner(subAccountUser, {
            name: '测试合伙人',
            phone: '13800138000',
            idCard: '440301199001011234',
            paymentMethod: 'wechat',
            paymentAccount: 'wx_partner_test',
            region: ['北京市', '北京市', '朝阳区'],
            intention: 'resource',
            applyReason: '测试申请',
          }),
        markPartnerApplicationReviewing: () =>
          service.markPartnerApplicationReviewing(subAccountUser, 1),
        approvePartnerApplication: () =>
          service.approvePartnerApplication(subAccountUser, 1),
        rejectPartnerApplication: () =>
          service.rejectPartnerApplication(subAccountUser, 1, {
            reason: '资料不完整',
          }),
        cancelPartnerApplication: () =>
          service.cancelPartnerApplication(subAccountUser, 1),
        addPartnerFollowUpNote: () =>
          service.addPartnerFollowUpNote(subAccountUser, 1, {
            content: '补充回访记录',
          }),
      };

      await expect(invocations[methodName]()).rejects.toThrow(
        '子账号无权访问平台会员中心',
      );
    },
  );

  it('listPlans 返回和前端一致的套餐配置', async () => {
    await expect(service.listPlans()).resolves.toEqual([
      {
        id: 'monthly',
        name: '月度会员',
        price: 3800,
        originalPrice: 3800,
        durationMonths: 1,
        validDays: null,
        monthlyPrice: 3800,
      },
      {
        id: 'quarterly',
        name: '季度会员',
        price: 9900,
        originalPrice: 11400,
        durationMonths: 3,
        validDays: null,
        badge: '省15元',
        recommended: true,
        monthlyPrice: 3300,
      },
      {
        id: 'yearly',
        name: '年度会员',
        price: 36900,
        originalPrice: 45600,
        durationMonths: 12,
        validDays: null,
        badge: '超划算',
        monthlyPrice: 3075,
      },
      {
        id: 'lifetime',
        name: '永久会员',
        price: 39800,
        originalPrice: null,
        durationMonths: null,
        validDays: 730,
      },
    ]);
  });

  it('listPlanRules 返回前端套餐对比表所需规则', () => {
    expect(service.listPlanRules()).toEqual({
      rows: [
        {
          key: 'product_limit',
          name: '商品录入',
          free: '最多 3 个',
          monthly: '最多 30 个',
          quarterly: '最多 100 个',
          yearly: '无上限',
        },
        {
          key: 'staff_limit',
          name: '员工管理',
          free: '0 人',
          monthly: '最多 5 人',
          quarterly: '最多 10 人',
          yearly: '无上限',
        },
        {
          key: 'history_range',
          name: '历史数据',
          free: '近 7 天',
          monthly: '不限时段',
          quarterly: '不限时段',
          yearly: '不限时段',
        },
        {
          key: 'report_export',
          name: '报表导出',
          free: '不可用',
          monthly: '可用',
          quarterly: '可用',
          yearly: '可用',
        },
        {
          key: 'bonus_points',
          name: '赠送积分',
          free: '0 分',
          monthly: '0 分',
          quarterly: '赠 300 分',
          yearly: '赠 1500 分',
        },
        {
          key: 'finance_access',
          name: '财务管理',
          free: '不可用',
          monthly: '可用',
          quarterly: '可用',
          yearly: '可用',
        },
        {
          key: 'marketing_access',
          name: '营销中心',
          free: '不可用',
          monthly: '可用',
          quarterly: '可用',
          yearly: '可用',
        },
        {
          key: 'space_limit',
          name: '空间管理',
          free: '最多 1 个',
          monthly: '最多 10 个',
          quarterly: '最多 30 个',
          yearly: '无上限',
        },
      ],
    });
  });

  it('getCenter 返回首页所需聚合字段', async () => {
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'quarterly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2099-05-01T00:00:00.000Z'),
      totalPoints: 188,
      availablePoints: 88,
    });
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 11,
      status: 'approved',
      name: '王建国',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '王建国',
      beanBalance: 25,
      totalEarnedBeans: 60,
      totalWithdrawnBeans: 10,
      joinedAt: new Date('2026-05-02T00:00:00.000Z'),
      reviewedAt: new Date('2026-05-02T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([
      {
        id: 21,
        planId: 'monthly',
        planName: '月度会员',
        amount: 3800,
        pointsUsed: 0,
        beansUsed: 0,
        status: 'paid',
        paymentChannel: 'wechat',
        paymentOrderId: 'WX180010',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      },
      {
        id: 22,
        planId: 'quarterly',
        planName: '季度会员',
        amount: 9900,
        pointsUsed: 0,
        beansUsed: 0,
        status: 'paid',
        paymentChannel: 'wechat',
        paymentOrderId: 'WX180011',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    ]);
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([
      {
        id: 7,
        inviteeName: '李四',
        inviteePhone: '159****4321',
        registeredAt: new Date('2026-05-10T00:00:00.000Z'),
        hasCharged: true,
        chargedAmount: 9900,
        chargedAt: new Date('2026-05-11T00:00:00.000Z'),
        chargedPlan: 'quarterly',
        rewardBeans: 22,
        settled: false,
      },
      {
        id: 8,
        inviteeName: '王五',
        inviteePhone: '187****3344',
        registeredAt: new Date('2026-05-12T00:00:00.000Z'),
        hasCharged: false,
        chargedAmount: null,
        chargedAt: null,
        chargedPlan: null,
        rewardBeans: null,
        settled: false,
      },
    ]);

    await expect(service.getCenter(user)).resolves.toEqual({
      memberInfo: {
        isActive: true,
        planId: 'quarterly',
        expiredAt: new Date('2099-05-01T00:00:00.000Z').getTime(),
        inviteCode: expect.any(String),
        totalPoints: 188,
        availablePoints: 88,
      },
      remainingDays: expect.any(Number),
      stats: {
        partnerCount: 1,
        totalPromos: 2,
        chargedPromos: 1,
      },
      paidOrderCount: 2,
      myPartnerApplication: {
        id: '11',
        name: '王建国',
        phone: '13800138000',
        idCard: '44030119900101123X',
        region: ['广东省', '深圳市', '南山区'],
        paymentMethod: 'wechat',
        paymentAccount: 'wx_test',
        intention: 'resource',
        status: 'approved',
        createdAt: new Date('2026-05-01T00:00:00.000Z').getTime(),
        reviewedAt: new Date('2026-05-02T00:00:00.000Z').getTime(),
        joinedAt: new Date('2026-05-02T00:00:00.000Z').getTime(),
        applyReason: '有行业资源',
        followUpNotes: [],
        beanBalance: 25,
        totalEarnedBeans: 60,
        totalWithdrawnBeans: 10,
      },
      approvedPartner: {
        id: '11',
        name: '王建国',
        phone: '13800138000',
        joinedAt: new Date('2026-05-02T00:00:00.000Z').getTime(),
        beanBalance: 25,
        totalEarnedBeans: 60,
        totalWithdrawnBeans: 10,
      },
      approvedPartners: [
        {
          id: '11',
          name: '王建国',
          phone: '13800138000',
          joinedAt: new Date('2026-05-02T00:00:00.000Z').getTime(),
          beanBalance: 25,
          totalEarnedBeans: 60,
          totalWithdrawnBeans: 10,
        },
      ],
    });
  });

  it('getCenter 对 ages会员按 730 天期限返回到期时间和剩余天数', async () => {
    const fixedNow = new Date('2026-05-22T00:00:00.000Z').getTime();
    const membershipStartAt = new Date('2026-05-01T00:00:00.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    try {
      prismaService.storeMembershipProfile.upsert.mockResolvedValue({
        id: 3,
        storeId: 18,
        currentPlanId: 'yearly',
        startsAt: membershipStartAt,
        expiresAt: null,
        totalPoints: 1880,
        availablePoints: 1280,
      });
      prismaService.storePartner.findUnique.mockResolvedValue(null);
      prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);
      prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

      await expect(service.getCenter(user)).resolves.toEqual({
        memberInfo: {
          isActive: true,
          planId: 'yearly',
          displayPlanName: 'ages会员',
          expiredAt: membershipStartAt.getTime() + 730 * 24 * 60 * 60 * 1000,
          inviteCode: expect.any(String),
          totalPoints: 1880,
          availablePoints: 1280,
        },
        remainingDays: 709,
        stats: {
          partnerCount: 0,
          totalPromos: 0,
          chargedPromos: 0,
        },
        paidOrderCount: 0,
        myPartnerApplication: null,
        approvedPartner: null,
        approvedPartners: [],
      });
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('getProfile 返回会员信息和审批通过合伙人的纯利豆余额', async () => {
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'quarterly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2099-05-01T00:00:00.000Z'),
      totalPoints: 188,
      availablePoints: 88,
    });
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 11,
      status: 'approved',
      name: '王建国',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: [],
      intention: 'resource',
      applyReason: null,
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '王建国',
      beanBalance: 25,
      totalEarnedBeans: 60,
      totalWithdrawnBeans: 10,
      joinedAt: new Date('2026-05-02T00:00:00.000Z'),
      reviewedAt: new Date('2026-05-02T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

    await expect(service.getProfile(user)).resolves.toEqual({
      memberInfo: {
        isActive: true,
        planId: 'quarterly',
        expiredAt: new Date('2099-05-01T00:00:00.000Z').getTime(),
        inviteCode: expect.any(String),
        totalPoints: 188,
        availablePoints: 88,
      },
      approvedPartner: {
        id: '11',
        name: '王建国',
        phone: '13800138000',
        joinedAt: new Date('2026-05-02T00:00:00.000Z').getTime(),
        beanBalance: 25,
        totalEarnedBeans: 60,
        totalWithdrawnBeans: 10,
      },
      approvedPartners: [
        {
          id: '11',
          name: '王建国',
          phone: '13800138000',
          joinedAt: new Date('2026-05-02T00:00:00.000Z').getTime(),
          beanBalance: 25,
          totalEarnedBeans: 60,
          totalWithdrawnBeans: 10,
        },
      ],
    });
  });

  it('listOrders 返回订单列表和汇总金额', async () => {
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: null,
      startsAt: null,
      expiresAt: null,
      totalPoints: 0,
      availablePoints: 0,
    });
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([
      {
        id: 21,
        planId: 'quarterly',
        planName: '季度会员',
        amount: 9900,
        pointsUsed: 0,
        beansUsed: 0,
        status: 'paid',
        paymentChannel: 'wechat',
        paymentOrderId: 'WX180001',
        createdAt: new Date('2026-05-14T10:00:00.000Z'),
      },
      {
        id: 22,
        planId: 'monthly',
        planName: '月度会员',
        amount: 3300,
        pointsUsed: 500,
        beansUsed: 10,
        status: 'paid',
        paymentChannel: 'wechat',
        paymentOrderId: 'WX180002',
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
      },
    ]);

    await expect(service.listOrders(user)).resolves.toEqual({
      overview: {
        orderCount: 2,
        totalAmount: 132,
      },
      items: [
        {
          id: '21',
          planId: 'quarterly',
          planName: '季度会员',
          amount: 99,
          pointsUsed: 0,
          beansUsed: 0,
          status: 'paid',
          createdAt: new Date('2026-05-14T10:00:00.000Z').getTime(),
          wxOrderId: 'WX180001',
        },
        {
          id: '22',
          planId: 'monthly',
          planName: '月度会员',
          amount: 33,
          pointsUsed: 500,
          beansUsed: 10,
          status: 'paid',
          createdAt: new Date('2026-05-13T10:00:00.000Z').getTime(),
          wxOrderId: 'WX180002',
        },
      ],
    });
  });

  it('listPointsLogs 返回积分汇总和明细列表', async () => {
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'yearly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2099-05-01T00:00:00.000Z'),
      totalPoints: 1880,
      availablePoints: 1280,
    });
    prismaService.storeMembershipPointsLog.findMany.mockResolvedValue([
      {
        id: 1,
        source: 'purchase_bonus',
        changeType: 'increase',
        changeAmount: 1500,
        description: '购买年度会员赠积分',
        expireAt: null,
        createdAt: new Date('2026-05-10T00:00:00.000Z'),
      },
      {
        id: 2,
        source: 'deduct_payment',
        changeType: 'decrease',
        changeAmount: 200,
        description: '订阅季度会员抵扣',
        expireAt: null,
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
      },
    ]);

    await expect(service.listPointsLogs(user)).resolves.toEqual({
      memberInfo: {
        isActive: true,
        planId: 'yearly',
        expiredAt: new Date('2099-05-01T00:00:00.000Z').getTime(),
        inviteCode: expect.any(String),
        totalPoints: 1880,
        availablePoints: 1280,
      },
      overview: {
        availablePoints: 1280,
        totalEarned: 1500,
        totalSpent: 200,
      },
      items: [
        {
          id: 'pts-1',
          amount: 1500,
          type: 'earn',
          source: 'purchase_bonus',
          description: '购买年度会员赠积分',
          createdAt: new Date('2026-05-10T00:00:00.000Z').getTime(),
        },
        {
          id: 'pts-2',
          amount: -200,
          type: 'spend',
          source: 'deduct_payment',
          description: '订阅季度会员抵扣',
          createdAt: new Date('2026-05-12T00:00:00.000Z').getTime(),
        },
      ],
    });
  });

  it('applyPartner 在没有历史记录时创建待审核申请', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });
    prismaService.storePartner.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 12,
        status: 'pending',
        name: '张三',
        phone: '13800138000',
        idCard: '44030119900101123X',
        region: ['广东省', '深圳市', '南山区'],
        intention: 'resource',
        applyReason: '有行业资源',
        paymentAccountType: 'wechat',
        paymentAccountNo: 'wx_test',
        paymentAccountName: '张三',
        beanBalance: 0,
        totalEarnedBeans: 0,
        totalWithdrawnBeans: 0,
        joinedAt: null,
        reviewedAt: null,
        createdAt: new Date('2026-05-15T00:00:00.000Z'),
      });
    prismaService.storePartnerApplication.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 101,
          storeId: 18,
          status: 'pending',
          name: '张三',
          phone: '13800138000',
          idCard: '44030119900101123X',
          region: ['广东省', '深圳市', '南山区'],
          intention: 'resource',
          applyReason: '有行业资源',
          paymentAccountType: 'wechat',
          paymentAccountNo: 'wx_test',
          paymentAccountName: '张三',
          reviewedAt: null,
          joinedAt: null,
          createdAt: new Date('2026-05-15T00:00:00.000Z'),
          followUpNotes: [],
        },
      ]);
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

    const result = await service.applyPartner(user, {
      name: '张三',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      paymentMethod: 'wechat',
      paymentAccount: 'wx_test',
      intention: 'resource',
      applyReason: '有行业资源',
    });

    expect(prismaService.storePartnerApplication.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        status: 'pending',
        name: '张三',
        phone: '13800138000',
        idCard: '44030119900101123X',
        region: ['广东省', '深圳市', '南山区'],
        intention: 'resource',
        applyReason: '有行业资源',
        paymentAccountType: 'wechat',
        paymentAccountNo: 'wx_test',
        paymentAccountName: '张三',
      },
    });
    expect(
      cacheInvalidatorService.invalidateMembershipDerived,
    ).toHaveBeenCalled();
    expect(prismaService.storePartner.upsert).not.toHaveBeenCalled();
    expect(prismaService.storePartner.create).not.toHaveBeenCalled();
    expect(result.currentApplication?.id).toBe('101');
    expect(result.currentApplication?.status).toBe('pending');
    expect(result.applications).toHaveLength(1);
  });

  it('applyPartner 在已有正式合伙人时允许新增其他人申请', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 12,
      status: 'approved',
      name: '王建国',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '王建国',
      beanBalance: 18,
      totalEarnedBeans: 30,
      totalWithdrawnBeans: 12,
      joinedAt: new Date('2026-05-15T00:00:00.000Z'),
      reviewedAt: new Date('2026-05-15T00:00:00.000Z'),
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
    });
    prismaService.storePartnerApplication.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 102,
          storeId: 18,
          status: 'pending',
          name: '李四',
          phone: '13900139000',
          idCard: '110101199203071234',
          region: ['北京市', '北京市', '东城区'],
          intention: 'agent',
          applyReason: '想拓展本地渠道',
          paymentAccountType: 'alipay',
          paymentAccountNo: 'alipay_ls',
          paymentAccountName: '李四',
          reviewedAt: null,
          joinedAt: null,
          createdAt: new Date('2026-05-16T00:00:00.000Z'),
          followUpNotes: [],
        },
      ]);
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

    const result = await service.applyPartner(user, {
      name: '李四',
      phone: '13900139000',
      idCard: '110101199203071234',
      region: ['北京市', '北京市', '东城区'],
      paymentMethod: 'alipay',
      paymentAccount: 'alipay_ls',
      intention: 'agent',
      applyReason: '想拓展本地渠道',
    });

    expect(prismaService.storePartnerApplication.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        status: 'pending',
        name: '李四',
        phone: '13900139000',
        idCard: '110101199203071234',
        region: ['北京市', '北京市', '东城区'],
        intention: 'agent',
        applyReason: '想拓展本地渠道',
        paymentAccountType: 'alipay',
        paymentAccountNo: 'alipay_ls',
        paymentAccountName: '李四',
      },
    });
    expect(prismaService.storePartner.upsert).not.toHaveBeenCalled();
    expect(result.isPartner).toBe(true);
    expect(result.currentApplication?.id).toBe('102');
    expect(result.currentApplication?.status).toBe('pending');
    expect(result.approvedPartner?.name).toBe('王建国');
  });

  it('applyPartner 在同一申请人已通过审核时拒绝重复申请', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 12,
      status: 'approved',
      name: '王建国',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '王建国',
      beanBalance: 18,
      totalEarnedBeans: 30,
      totalWithdrawnBeans: 12,
      joinedAt: new Date('2026-05-15T00:00:00.000Z'),
      reviewedAt: new Date('2026-05-15T00:00:00.000Z'),
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
    });
    prismaService.storePartnerApplication.findMany.mockResolvedValue([]);

    await expect(
      service.applyPartner(user, {
        name: '王建国',
        phone: '13800138000',
        idCard: '44030119900101123x',
        region: ['广东省', '深圳市', '南山区'],
        paymentMethod: 'wechat',
        paymentAccount: 'wx_test',
        intention: 'resource',
        applyReason: '重复申请',
      }),
    ).rejects.toThrow('该合伙人已通过审核，无需重复申请');
    expect(prismaService.storePartnerApplication.create).not.toHaveBeenCalled();
  });

  it('markPartnerApplicationReviewing 将申请切换为审核中', async () => {
    prismaService.storePartnerApplication.findUnique.mockResolvedValue({
      id: 101,
      storeId: 18,
      status: 'pending',
      name: '张三',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '张三',
      reviewedAt: null,
      joinedAt: null,
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      followUpNotes: [],
    });
    prismaService.storePartnerApplication.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 12,
      status: 'reviewing',
      name: '张三',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '张三',
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
      joinedAt: null,
      reviewedAt: null,
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
    });
    prismaService.storePartnerApplication.findMany.mockResolvedValue([
      {
        id: 101,
        storeId: 18,
        status: 'reviewing',
        name: '张三',
        phone: '13800138000',
        idCard: '44030119900101123X',
        region: ['广东省', '深圳市', '南山区'],
        intention: 'resource',
        applyReason: '有行业资源',
        paymentAccountType: 'wechat',
        paymentAccountNo: 'wx_test',
        paymentAccountName: '张三',
        reviewedAt: null,
        joinedAt: null,
        createdAt: new Date('2026-05-15T00:00:00.000Z'),
        followUpNotes: [],
      },
    ]);
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

    const result = await service.markPartnerApplicationReviewing(user, 101);

    expect(
      prismaService.storePartnerApplication.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: 101,
        storeId: 18,
        status: 'pending',
      },
      data: {
        status: 'reviewing',
        reviewedAt: null,
        joinedAt: null,
      },
    });
    expect(
      cacheInvalidatorService.invalidateMembershipDerived,
    ).toHaveBeenCalled();
    expect(prismaService.storePartner.upsert).not.toHaveBeenCalled();
    expect(prismaService.storePartner.update).not.toHaveBeenCalled();
    expect(result.currentApplication?.status).toBe('reviewing');
  });

  it('approvePartnerApplication 审核通过后同步正式合伙人状态', async () => {
    const approvedAt = new Date('2026-05-16T09:00:00.000Z');
    prismaService.storePartnerApplication.findUnique.mockResolvedValue({
      id: 101,
      storeId: 18,
      status: 'reviewing',
      name: '张三',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '张三',
      reviewedAt: null,
      joinedAt: null,
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      followUpNotes: [],
    });
    prismaService.storePartnerApplication.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaService.storePartner.findUnique.mockResolvedValue(null);
    prismaService.storePartner.findMany.mockResolvedValue([
      {
        id: 12,
        status: 'approved',
        name: '张三',
        phone: '13800138000',
        idCard: '44030119900101123X',
        region: ['广东省', '深圳市', '南山区'],
        intention: 'resource',
        applyReason: '有行业资源',
        paymentAccountType: 'wechat',
        paymentAccountNo: 'wx_test',
        paymentAccountName: '张三',
        beanBalance: 18,
        totalEarnedBeans: 30,
        totalWithdrawnBeans: 12,
        joinedAt: approvedAt,
        reviewedAt: approvedAt,
        createdAt: new Date('2026-05-15T00:00:00.000Z'),
      },
    ]);
    prismaService.storePartnerApplication.findMany.mockResolvedValue([
      {
        id: 101,
        storeId: 18,
        status: 'approved',
        name: '张三',
        phone: '13800138000',
        idCard: '44030119900101123X',
        region: ['广东省', '深圳市', '南山区'],
        intention: 'resource',
        applyReason: '有行业资源',
        paymentAccountType: 'wechat',
        paymentAccountNo: 'wx_test',
        paymentAccountName: '张三',
        reviewedAt: approvedAt,
        joinedAt: approvedAt,
        createdAt: new Date('2026-05-15T00:00:00.000Z'),
        followUpNotes: [],
      },
    ]);
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

    const result = await service.approvePartnerApplication(user, 101);

    expect(
      prismaService.storePartnerApplication.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: 101,
        storeId: 18,
        status: { in: ['pending', 'reviewing'] },
      },
      data: {
        status: 'approved',
        reviewedAt: expect.any(Date),
        joinedAt: expect.any(Date),
      },
    });
    expect(prismaService.storePartner.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: 18,
          status: 'approved',
          reviewedAt: expect.any(Date),
          joinedAt: expect.any(Date),
        }),
      }),
    );
    expect(
      cacheInvalidatorService.invalidateMembershipDerived,
    ).toHaveBeenCalled();
    expect(result.isPartner).toBe(true);
    expect(result.currentApplication?.status).toBe('approved');
    expect(result.approvedPartner?.beanBalance).toBe(18);
  });

  it('cancelPartnerApplication 删除待审核申请并返回最新列表', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });
    prismaService.storePartnerApplication.findUnique.mockResolvedValue({
      id: 101,
      storeId: 18,
      status: 'pending',
      name: '张三',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '张三',
      reviewedAt: null,
      joinedAt: null,
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      followUpNotes: [],
    });
    prismaService.storePartnerApplication.deleteMany.mockResolvedValue({
      count: 1,
    });
    prismaService.storePartner.findUnique.mockResolvedValue(null);
    prismaService.storePartnerApplication.findMany.mockResolvedValue([]);
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);
    const result = await service.cancelPartnerApplication(user, 101);

    expect(
      prismaService.storePartnerApplication.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        id: 101,
        storeId: 18,
        status: { in: ['pending', 'reviewing'] },
      },
    });
    expect(
      cacheInvalidatorService.invalidateMembershipDerived,
    ).toHaveBeenCalled();
    expect(prismaService.storePartner.deleteMany).not.toHaveBeenCalled();
    expect(result.currentApplication).toBeNull();
    expect(result.applications).toEqual([]);
  });

  it('getPromoCenter 返回全量和分时段推广统计', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-16T12:00:00.000Z'));
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'quarterly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2099-05-01T00:00:00.000Z'),
      totalPoints: 188,
      availablePoints: 88,
    });
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 11,
      status: 'approved',
      name: '王建国',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: [],
      intention: 'resource',
      applyReason: null,
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '王建国',
      beanBalance: 25,
      totalEarnedBeans: 60,
      totalWithdrawnBeans: 10,
      joinedAt: new Date('2026-05-02T00:00:00.000Z'),
      reviewedAt: new Date('2026-05-02T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([
      {
        id: 7,
        inviteeName: '今日已充值',
        inviteePhone: '159****4321',
        registeredAt: new Date('2026-05-16T08:00:00.000Z'),
        hasCharged: true,
        chargedAmount: 9900,
        chargedAt: new Date('2026-05-16T09:00:00.000Z'),
        chargedPlan: 'quarterly',
        rewardBeans: 22,
        settled: false,
      },
      {
        id: 8,
        inviteeName: '本月未充值',
        inviteePhone: '187****3344',
        registeredAt: new Date('2026-05-10T08:00:00.000Z'),
        hasCharged: false,
        chargedAmount: null,
        chargedAt: null,
        chargedPlan: null,
        rewardBeans: null,
        settled: false,
      },
      {
        id: 9,
        inviteeName: '今年已充值',
        inviteePhone: '186****2233',
        registeredAt: new Date('2026-02-10T08:00:00.000Z'),
        hasCharged: true,
        chargedAmount: 3800,
        chargedAt: new Date('2026-02-11T08:00:00.000Z'),
        chargedPlan: 'monthly',
        rewardBeans: 20,
        settled: true,
      },
      {
        id: 10,
        inviteeName: '去年记录',
        inviteePhone: '185****1122',
        registeredAt: new Date('2025-12-31T08:00:00.000Z'),
        hasCharged: true,
        chargedAmount: 36900,
        chargedAt: new Date('2025-12-31T09:00:00.000Z'),
        chargedPlan: 'yearly',
        rewardBeans: 100,
        settled: true,
      },
    ]);

    const result = await service.getPromoCenter(user);

    expect(result.stats).toEqual({
      totalPromos: 4,
      chargedPromos: 3,
      promoRate: 75,
      earnedBeans: 142,
    });
    expect(result.statsByPeriod.today).toEqual({
      totalPromos: 1,
      chargedPromos: 1,
      promoRate: 100,
      earnedBeans: 22,
    });
    expect(result.statsByPeriod.month).toEqual({
      totalPromos: 2,
      chargedPromos: 1,
      promoRate: 50,
      earnedBeans: 22,
    });
    expect(result.statsByPeriod.year).toEqual({
      totalPromos: 3,
      chargedPromos: 2,
      promoRate: 67,
      earnedBeans: 42,
    });

    jest.useRealTimers();
  });

  it('getPromoCenter 对已审核合伙人 0 个本月付费推广仍返回新星等级', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-16T12:00:00.000Z'));
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'quarterly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2099-05-01T00:00:00.000Z'),
      totalPoints: 188,
      availablePoints: 88,
    });
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 11,
      status: 'approved',
      name: '王建国',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: [],
      intention: 'resource',
      applyReason: null,
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '王建国',
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
      joinedAt: new Date('2026-05-02T00:00:00.000Z'),
      reviewedAt: new Date('2026-05-02T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

    const result = await service.getPromoCenter(user);

    expect(result.level).toEqual({
      partnerLevel: 'star',
      monthChargedCount: 0,
      monthCountToNextLevel: 10,
    });

    jest.useRealTimers();
  });

  it('rejectPartnerApplication 会写入驳回备注并返回历史备注', async () => {
    const rejectedAt = new Date('2026-05-16T10:00:00.000Z');
    prismaService.storePartnerApplication.findUnique.mockResolvedValue({
      id: 101,
      storeId: 18,
      status: 'pending',
      name: '张三',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '张三',
      reviewedAt: null,
      joinedAt: null,
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      followUpNotes: [],
    });
    prismaService.storePartnerApplication.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 12,
      status: 'rejected',
      name: '张三',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '张三',
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
      joinedAt: null,
      reviewedAt: rejectedAt,
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
    });
    prismaService.storePartnerApplication.findMany.mockResolvedValue([
      {
        id: 101,
        storeId: 18,
        status: 'rejected',
        name: '张三',
        phone: '13800138000',
        idCard: '44030119900101123X',
        region: ['广东省', '深圳市', '南山区'],
        intention: 'resource',
        applyReason: '有行业资源',
        paymentAccountType: 'wechat',
        paymentAccountNo: 'wx_test',
        paymentAccountName: '张三',
        reviewedAt: rejectedAt,
        joinedAt: null,
        createdAt: new Date('2026-05-15T00:00:00.000Z'),
        followUpNotes: [
          {
            id: 9,
            content: '资料不完整，请补充身份证照片',
            createdAt: rejectedAt,
          },
        ],
      },
    ]);
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

    const result = await service.rejectPartnerApplication(user, 101, {
      reason: '资料不完整，请补充身份证照片',
    });

    expect(
      prismaService.storePartnerApplicationNote.create,
    ).toHaveBeenCalledWith({
      data: {
        applicationId: 101,
        content: '资料不完整，请补充身份证照片',
      },
    });
    expect(
      cacheInvalidatorService.invalidateMembershipDerived,
    ).toHaveBeenCalled();
    expect(result.currentApplication?.status).toBe('rejected');
    expect(result.currentApplication?.followUpNotes[0]?.content).toBe(
      '资料不完整，请补充身份证照片',
    );
  });

  it('addPartnerFollowUpNote 会追加跟进备注', async () => {
    const noteAt = new Date('2026-05-16T11:00:00.000Z');
    prismaService.storePartnerApplication.findUnique.mockResolvedValue({
      id: 101,
      storeId: 18,
      status: 'reviewing',
      name: '张三',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '张三',
      reviewedAt: null,
      joinedAt: null,
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      followUpNotes: [],
    });
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 12,
      status: 'reviewing',
      name: '张三',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: ['广东省', '深圳市', '南山区'],
      intention: 'resource',
      applyReason: '有行业资源',
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '张三',
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
      joinedAt: null,
      reviewedAt: null,
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
    });
    prismaService.storePartnerApplication.findMany.mockResolvedValue([
      {
        id: 101,
        storeId: 18,
        status: 'reviewing',
        name: '张三',
        phone: '13800138000',
        idCard: '44030119900101123X',
        region: ['广东省', '深圳市', '南山区'],
        intention: 'resource',
        applyReason: '有行业资源',
        paymentAccountType: 'wechat',
        paymentAccountNo: 'wx_test',
        paymentAccountName: '张三',
        reviewedAt: null,
        joinedAt: null,
        createdAt: new Date('2026-05-15T00:00:00.000Z'),
        followUpNotes: [
          {
            id: 11,
            content: '已电话沟通，待补充银行卡信息',
            createdAt: noteAt,
          },
        ],
      },
    ]);
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);

    const result = await service.addPartnerFollowUpNote(user, 101, {
      content: '已电话沟通，待补充银行卡信息',
    });

    expect(
      prismaService.storePartnerApplicationNote.create,
    ).toHaveBeenCalledWith({
      data: {
        applicationId: 101,
        content: '已电话沟通，待补充银行卡信息',
      },
    });
    expect(result.currentApplication?.followUpNotes).toHaveLength(1);
    expect(result.currentApplication?.followUpNotes[0]?.content).toBe(
      '已电话沟通，待补充银行卡信息',
    );
  });

  it('purchaseOrder 仅允许老板操作', async () => {
    prismaService.store.findFirst.mockResolvedValue(null);

    await expect(
      service.purchaseOrder(user, {
        planId: 'monthly',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('purchaseOrder 使用积分和纯利豆后创建 paid 订单并更新会员状态', async () => {
    const partnerWithBeans = {
      id: 11,
      storeId: 18,
      status: 'approved',
      name: '王建国',
      phone: '13800138000',
      idCard: '44030119900101123X',
      region: [],
      intention: 'resource',
      applyReason: null,
      paymentAccountType: 'wechat',
      paymentAccountNo: 'wx_test',
      paymentAccountName: '王建国',
      beanBalance: 20,
      totalEarnedBeans: 20,
      totalWithdrawnBeans: 0,
      joinedAt: new Date('2026-05-01T00:00:00.000Z'),
      reviewedAt: new Date('2026-05-01T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    };
    const partnerAfterDeduct = {
      ...partnerWithBeans,
      beanBalance: 0,
    };
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'monthly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2026-05-20T00:00:00.000Z'),
      totalPoints: 2000,
      availablePoints: 2000,
    });
    // findMany is called 4 times in the transaction:
    // 1. findStorePartners (initial) → beanBalance: 20
    // 2. pre-deduct validation → storeId + status only
    // 3. post-deduct validation → beanBalance: 0 (non-negative check)
    // 4. findStorePartners (final) → beanBalance: 0 (for response)
    prismaService.storePartner.findMany
      .mockResolvedValueOnce([partnerWithBeans])
      .mockResolvedValueOnce([{ id: 11, storeId: 18, status: 'approved' }])
      .mockResolvedValueOnce([{ id: 11, beanBalance: 0 }])
      .mockResolvedValueOnce([partnerAfterDeduct]);
    prismaService.storePartner.findUnique.mockResolvedValue(partnerAfterDeduct);
    prismaService.storeMembershipProfile.update.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'quarterly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2026-08-18T00:00:00.000Z'),
      totalPoints: 300,
      availablePoints: 300,
    });
    prismaService.storeMembershipOrder.create.mockResolvedValue({
      id: 31,
      planId: 'quarterly',
      planName: '季度会员',
      amount: 5900,
      pointsUsed: 2000,
      beansUsed: 20,
      status: 'paid',
      paymentChannel: 'wechat',
      paymentOrderId: 'WX18123456',
      createdAt: new Date('2026-05-20T00:00:00.000Z'),
    });

    prismaService.storeMembershipOrder.findMany.mockResolvedValue([
      {
        id: 31,
        planId: 'quarterly',
        planName: '季度会员',
        amount: 5900,
        pointsUsed: 2000,
        beansUsed: 20,
        status: 'paid',
        paymentChannel: 'wechat',
        paymentOrderId: 'WX18123456',
        createdAt: new Date('2026-05-20T00:00:00.000Z'),
      },
    ]);

    const result = await service.purchaseOrder(user, {
      planId: 'quarterly',
      usePoints: 2000,
      useBeans: 20,
    });

    expect(prismaService.storePartner.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: {
        beanBalance: { decrement: 20 },
      },
    });
    expect(
      cacheInvalidatorService.invalidateMembershipDerived,
    ).toHaveBeenCalled();
    expect(prismaService.storePartnerBeanLog.createMany).toHaveBeenCalledWith({
      data: [
        {
          storeId: 18,
          partnerId: 11,
          source: 'deduct_payment',
          changeAmount: -20,
          description: '纯利豆抵扣 · 订阅季度会员',
          relatedPlanType: 'quarterly',
        },
      ],
    });
    expect(
      prismaService.storeMembershipPointsLog.create,
    ).toHaveBeenNthCalledWith(1, {
      data: {
        storeId: 18,
        profileId: 3,
        source: 'deduct_payment',
        changeType: 'decrease',
        changeAmount: 2000,
        description: '订阅季度会员抵扣',
      },
    });
    expect(
      prismaService.storeMembershipPointsLog.create,
    ).toHaveBeenNthCalledWith(2, {
      data: {
        storeId: 18,
        profileId: 3,
        source: 'purchase_bonus',
        changeType: 'increase',
        changeAmount: 300,
        description: '购买季度会员赠积分',
      },
    });
    expect(result).toEqual({
      order: {
        id: '31',
        planId: 'quarterly',
        planName: '季度会员',
        amount: 59,
        pointsUsed: 2000,
        beansUsed: 20,
        status: 'paid',
        createdAt: new Date('2026-05-20T00:00:00.000Z').getTime(),
        wxOrderId: 'WX18123456',
      },
      profile: {
        memberInfo: {
          isActive: true,
          planId: 'quarterly',
          expiredAt: new Date('2026-08-18T00:00:00.000Z').getTime(),
          inviteCode: expect.any(String),
          totalPoints: 300,
          availablePoints: 300,
        },
        approvedPartner: {
          id: '11',
          name: '王建国',
          phone: '13800138000',
          joinedAt: new Date('2026-05-01T00:00:00.000Z').getTime(),
          beanBalance: 0,
          totalEarnedBeans: 20,
          totalWithdrawnBeans: 0,
        },
        approvedPartners: [
          {
            id: '11',
            name: '王建国',
            phone: '13800138000',
            joinedAt: new Date('2026-05-01T00:00:00.000Z').getTime(),
            beanBalance: 0,
            totalEarnedBeans: 20,
            totalWithdrawnBeans: 0,
          },
        ],
      },
      overview: {
        orderCount: 1,
        totalAmount: 59,
      },
    });
  });

  it('purchaseOrder 购买 lifetime 时按有效期天数写入永久会员主链路', async () => {
    const fixedNow = new Date('2026-05-23T00:00:00.000Z');
    const lifetimeExpiry = new Date(
      fixedNow.getTime() + 730 * 24 * 60 * 60 * 1000,
    );
    jest.useFakeTimers().setSystemTime(fixedNow);

    try {
      prismaService.store.findFirst.mockResolvedValue({ id: 18 });
      prismaService.storeMembershipProfile.upsert.mockResolvedValue({
        id: 3,
        storeId: 18,
        currentPlanId: null,
        startsAt: null,
        expiresAt: null,
        totalPoints: 0,
        availablePoints: 0,
      });
      prismaService.storePartner.findUnique.mockResolvedValue(null);
      prismaService.storeMembershipProfile.update.mockResolvedValue({
        id: 3,
        storeId: 18,
        currentPlanId: 'lifetime',
        startsAt: fixedNow,
        expiresAt: lifetimeExpiry,
        totalPoints: 0,
        availablePoints: 0,
      });
      prismaService.storeMembershipOrder.create.mockResolvedValue({
        id: 40,
        planId: 'lifetime',
        planName: '永久会员',
        amount: 39800,
        pointsUsed: 0,
        beansUsed: 0,
        status: 'paid',
        paymentChannel: 'wechat',
        paymentOrderId: 'WX18129999',
        createdAt: fixedNow,
      });
      prismaService.storeMembershipOrder.findMany.mockResolvedValue([
        {
          id: 40,
          planId: 'lifetime',
          planName: '永久会员',
          amount: 39800,
          pointsUsed: 0,
          beansUsed: 0,
          status: 'paid',
          paymentChannel: 'wechat',
          paymentOrderId: 'WX18129999',
          createdAt: fixedNow,
        },
      ]);

      const result = await service.purchaseOrder(user, {
        planId: 'lifetime',
      });

      expect(prismaService.storeMembershipProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentPlanId: 'lifetime',
            startsAt: fixedNow,
            expiresAt: lifetimeExpiry,
          }),
        }),
      );
      expect(result.profile.memberInfo).toMatchObject({
        isActive: true,
        planId: 'lifetime',
        expiredAt: lifetimeExpiry.getTime(),
        totalPoints: 0,
        availablePoints: 0,
      });
      expect(result.order).toMatchObject({
        planId: 'lifetime',
        planName: '永久会员',
        amount: 398,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('purchaseOrder 同级续费时保留原会员类型并叠加时长', async () => {
    // 冻结时间到 2026-06-10，确保当前 expiresAt(2026-06-20) 仍在有效期内
    jest.useFakeTimers().setSystemTime(new Date('2026-06-10T00:00:00.000Z'));

    try {
      prismaService.store.findFirst.mockResolvedValue({ id: 18 });
      prismaService.storeMembershipProfile.upsert.mockResolvedValue({
        id: 3,
        storeId: 18,
        currentPlanId: 'monthly',
        startsAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2026-06-20T00:00:00.000Z'),
        totalPoints: 0,
        availablePoints: 0,
      });
      prismaService.storePartner.findUnique.mockResolvedValue(null);
      prismaService.storeMembershipProfile.update.mockResolvedValue({
        id: 3,
        storeId: 18,
        currentPlanId: 'monthly',
        startsAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2026-07-20T00:00:00.000Z'),
        totalPoints: 0,
        availablePoints: 0,
      });
      prismaService.storeMembershipOrder.create.mockResolvedValue({
        id: 32,
        planId: 'monthly',
        planName: '月度会员',
        amount: 3800,
        pointsUsed: 0,
        beansUsed: 0,
        status: 'paid',
        paymentChannel: 'wechat',
        paymentOrderId: 'WX18123457',
        createdAt: new Date('2026-05-18T00:00:00.000Z'),
      });
      prismaService.storeMembershipOrder.findMany.mockResolvedValue([
        {
          id: 32,
          planId: 'monthly',
          planName: '月度会员',
          amount: 3800,
          pointsUsed: 0,
          beansUsed: 0,
          status: 'paid',
          paymentChannel: 'wechat',
          paymentOrderId: 'WX18123457',
          createdAt: new Date('2026-05-18T00:00:00.000Z'),
        },
      ]);

      const result = await service.purchaseOrder(user, {
        planId: 'monthly',
      });

      expect(prismaService.storeMembershipProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentPlanId: 'monthly',
            expiresAt: new Date('2026-07-20T00:00:00.000Z'),
          }),
        }),
      );
      expect(result.profile.memberInfo.planId).toBe('monthly');
      expect(result.profile.memberInfo.expiredAt).toBe(
        new Date('2026-07-20T00:00:00.000Z').getTime(),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('purchaseOrder 购买低等级套餐时不覆盖当前高等级会员', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'quarterly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2026-08-20T00:00:00.000Z'),
      totalPoints: 0,
      availablePoints: 0,
    });
    prismaService.storePartner.findUnique.mockResolvedValue(null);
    prismaService.storeMembershipProfile.update.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: 'quarterly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2026-09-19T00:00:00.000Z'),
      totalPoints: 0,
      availablePoints: 0,
    });
    prismaService.storeMembershipOrder.create.mockResolvedValue({
      id: 33,
      planId: 'monthly',
      planName: '月度会员',
      amount: 3800,
      pointsUsed: 0,
      beansUsed: 0,
      status: 'paid',
      paymentChannel: 'wechat',
      paymentOrderId: 'WX18123458',
      createdAt: new Date('2026-05-18T00:00:00.000Z'),
    });
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([
      {
        id: 33,
        planId: 'monthly',
        planName: '月度会员',
        amount: 3800,
        pointsUsed: 0,
        beansUsed: 0,
        status: 'paid',
        paymentChannel: 'wechat',
        paymentOrderId: 'WX18123458',
        createdAt: new Date('2026-05-18T00:00:00.000Z'),
      },
    ]);

    const result = await service.purchaseOrder(user, {
      planId: 'monthly',
    });

    expect(prismaService.storeMembershipProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentPlanId: 'quarterly',
          expiresAt: new Date('2026-09-19T00:00:00.000Z'),
        }),
      }),
    );
    expect(result.profile.memberInfo.planId).toBe('quarterly');
    expect(result.order.planId).toBe('monthly');
  });

  it('purchaseOrder ages会员购买月度会员后保持 ages 并叠加天数', async () => {
    await expectAgesPurchaseKeepsMaskedPlan({
      planId: 'monthly',
      planName: '月度会员',
      durationDays: 30,
      orderId: 34,
      amount: 3800,
      paymentOrderId: 'WX18123459',
      bonusPoints: 0,
    });
  });

  it('purchaseOrder ages会员购买季度会员后保持 ages 并叠加天数', async () => {
    await expectAgesPurchaseKeepsMaskedPlan({
      planId: 'quarterly',
      planName: '季度会员',
      durationDays: 90,
      orderId: 35,
      amount: 9900,
      paymentOrderId: 'WX18123460',
      bonusPoints: 300,
    });
  });

  it('purchaseOrder ages会员购买年度会员后保持 ages 并叠加天数', async () => {
    await expectAgesPurchaseKeepsMaskedPlan({
      planId: 'yearly',
      planName: '年度会员',
      durationDays: 360,
      orderId: 36,
      amount: 36900,
      paymentOrderId: 'WX18123461',
      bonusPoints: 1500,
    });
  });

  it('purchaseOrder 请求纯利豆但当前不可抵扣时抛错', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({
      id: 3,
      storeId: 18,
      currentPlanId: null,
      startsAt: null,
      expiresAt: null,
      totalPoints: 0,
      availablePoints: 0,
    });
    prismaService.storePartner.findUnique.mockResolvedValue(null);

    await expect(
      service.purchaseOrder(user, {
        planId: 'monthly',
        useBeans: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
