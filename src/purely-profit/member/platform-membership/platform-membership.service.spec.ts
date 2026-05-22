import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipService } from './platform-membership.service';

describe('PlatformMembershipService', () => {
  let service: PlatformMembershipService;

  const prismaService = {
    store: {
      findFirst: jest.fn(),
    },
    storePartner: {
      findUnique: jest.fn(),
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
      findMany: jest.fn(),
    },
    storeMembershipProfile: {
      upsert: jest.fn(),
      update: jest.fn(),
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
    $transaction: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.storePartnerApplication.findMany.mockResolvedValue([]);
    prismaService.storePartnerApplicationNote.create.mockResolvedValue({ id: 1 });
    prismaService.storePartner.upsert.mockResolvedValue({ id: 11 });
    prismaService.$transaction.mockImplementation(
      async (
        callback: (transactionClient: typeof prismaService) => Promise<unknown>,
      ) => callback(prismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformMembershipService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<PlatformMembershipService>(PlatformMembershipService);
  });

  it('listPlans 返回和前端一致的套餐配置', () => {
    expect(service.listPlans()).toEqual([
      {
        id: 'monthly',
        name: '月度会员',
        price: 3800,
        originalPrice: 3800,
        durationMonths: 1,
        monthlyPrice: 3800,
      },
      {
        id: 'quarterly',
        name: '季度会员',
        price: 9900,
        originalPrice: 11400,
        durationMonths: 3,
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
        badge: '最划算',
        monthlyPrice: 3075,
      },
    ]);
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
    prismaService.storeMembershipOrder.count.mockResolvedValue(2);
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
        name: '王建国',
        phone: '13800138000',
        joinedAt: new Date('2026-05-02T00:00:00.000Z').getTime(),
        beanBalance: 25,
        totalEarnedBeans: 60,
        totalWithdrawnBeans: 10,
      },
    });
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
    prismaService.storeMembershipOrder.count.mockResolvedValue(0);
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
        name: '王建国',
        phone: '13800138000',
        joinedAt: new Date('2026-05-02T00:00:00.000Z').getTime(),
        beanBalance: 25,
        totalEarnedBeans: 60,
        totalWithdrawnBeans: 10,
      },
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
        pointsDeducted: 0,
        pointsUsed: 0,
        beanDeducted: 0,
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
        pointsDeducted: 500,
        pointsUsed: 500,
        beanDeducted: 1000,
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
        totalAmount: 13200,
      },
      items: [
        {
          id: '21',
          planId: 'quarterly',
          planName: '季度会员',
          amount: 9900,
          pointsDeducted: 0,
          pointsUsed: 0,
          beanDeducted: 0,
          beansUsed: 0,
          status: 'paid',
          createdAt: new Date('2026-05-14T10:00:00.000Z').getTime(),
          wxOrderId: 'WX180001',
        },
        {
          id: '22',
          planId: 'monthly',
          planName: '月度会员',
          amount: 3300,
          pointsDeducted: 500,
          pointsUsed: 500,
          beanDeducted: 1000,
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
        changeAmount: 1500,
        description: '购买年度会员赠积分',
        expireAt: null,
        createdAt: new Date('2026-05-10T00:00:00.000Z'),
      },
      {
        id: 2,
        source: 'deduct_payment',
        changeAmount: -200,
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
    expect(prismaService.storePartner.upsert).toHaveBeenCalledWith({
      where: { storeId: 18 },
      create: {
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
      },
      update: {
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
      },
    });
    expect(result.currentApplication?.id).toBe('101');
    expect(result.currentApplication?.status).toBe('pending');
    expect(result.applications).toHaveLength(1);
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

    expect(prismaService.storePartnerApplication.updateMany).toHaveBeenCalledWith({
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
    expect(prismaService.storePartner.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 18 },
        update: expect.objectContaining({
          status: 'reviewing',
        }),
      }),
    );
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
    prismaService.storePartner.findUnique.mockResolvedValue({
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
    });
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

    expect(prismaService.storePartnerApplication.updateMany).toHaveBeenCalledWith({
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
    expect(prismaService.storePartner.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 18 },
        update: expect.objectContaining({
          status: 'approved',
          reviewedAt: expect.any(Date),
          joinedAt: expect.any(Date),
        }),
      }),
    );
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
    prismaService.storePartnerApplication.deleteMany.mockResolvedValue({ count: 1 });
    prismaService.storePartner.findUnique.mockResolvedValue(null);
    prismaService.storePartnerApplication.findMany.mockResolvedValue([]);
    prismaService.storeMembershipPromoRecord.findMany.mockResolvedValue([]);
    prismaService.storePartner.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service.cancelPartnerApplication(user, 101);

    expect(prismaService.storePartnerApplication.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 101,
        storeId: 18,
        status: { in: ['pending', 'reviewing'] },
      },
    });
    expect(prismaService.storePartner.deleteMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        status: { in: ['pending', 'reviewing', 'rejected'] },
      },
    });
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

    expect(prismaService.storePartnerApplicationNote.create).toHaveBeenCalledWith({
      data: {
        applicationId: 101,
        content: '资料不完整，请补充身份证照片',
      },
    });
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

    expect(prismaService.storePartnerApplicationNote.create).toHaveBeenCalledWith({
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
    prismaService.storePartner.findUnique
      .mockResolvedValueOnce({
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
        beanBalance: 20,
        totalEarnedBeans: 20,
        totalWithdrawnBeans: 0,
        joinedAt: new Date('2026-05-01T00:00:00.000Z'),
        reviewedAt: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
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
        totalEarnedBeans: 20,
        totalWithdrawnBeans: 0,
        joinedAt: new Date('2026-05-01T00:00:00.000Z'),
        reviewedAt: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      });
    prismaService.storePartner.updateMany.mockResolvedValue({ count: 1 });
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
      pointsDeducted: 2000,
      pointsUsed: 2000,
      beanDeducted: 2000,
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
        pointsDeducted: 2000,
        pointsUsed: 2000,
        beanDeducted: 2000,
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

    expect(prismaService.storePartner.updateMany).toHaveBeenCalledWith({
      where: {
        id: 11,
        storeId: 18,
        status: 'approved',
        beanBalance: { gte: 20 },
      },
      data: {
        beanBalance: { decrement: 20 },
      },
    });
    expect(prismaService.storePartnerBeanLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        partnerId: 11,
        source: 'deduct_payment',
        changeAmount: -20,
        description: '纯利豆抵扣 · 订阅季度会员',
        relatedPlanType: 'quarterly',
      },
    });
    expect(prismaService.storeMembershipPointsLog.create).toHaveBeenNthCalledWith(
      1,
      {
        data: {
          storeId: 18,
          profileId: 3,
          source: 'deduct_payment',
          changeAmount: -2000,
          description: '订阅季度会员抵扣',
        },
      },
    );
    expect(prismaService.storeMembershipPointsLog.create).toHaveBeenNthCalledWith(
      2,
      {
        data: {
          storeId: 18,
          profileId: 3,
          source: 'purchase_bonus',
          changeAmount: 300,
          description: '购买季度会员赠积分',
        },
      },
    );
    expect(result).toEqual({
      order: {
        id: '31',
        planId: 'quarterly',
        planName: '季度会员',
        amount: 5900,
        pointsDeducted: 2000,
        pointsUsed: 2000,
        beanDeducted: 2000,
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
          name: '王建国',
          phone: '13800138000',
          joinedAt: new Date('2026-05-01T00:00:00.000Z').getTime(),
          beanBalance: 0,
          totalEarnedBeans: 20,
          totalWithdrawnBeans: 0,
        },
      },
      overview: {
        orderCount: 1,
        totalAmount: 5900,
      },
    });
  });

  it('purchaseOrder 同级续费时保留原会员类型并叠加时长', async () => {
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
      pointsDeducted: 0,
      pointsUsed: 0,
      beanDeducted: 0,
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
        pointsDeducted: 0,
        pointsUsed: 0,
        beanDeducted: 0,
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
      pointsDeducted: 0,
      pointsUsed: 0,
      beanDeducted: 0,
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
        pointsDeducted: 0,
        pointsUsed: 0,
        beanDeducted: 0,
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
