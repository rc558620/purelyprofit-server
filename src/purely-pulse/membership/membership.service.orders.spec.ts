import { ForbiddenException } from '@nestjs/common';
import {
  createPulseMembershipServiceTestingContext,
  type PulseMembershipServiceTestingContext,
} from './membership.service.test-setup';

describe('PulseMembershipService orders', () => {
  let context: PulseMembershipServiceTestingContext;

  beforeEach(async () => {
    jest.clearAllMocks();
    context = await createPulseMembershipServiceTestingContext();
  });

  it('listPlans 直接复用平台会员配置读取结果', async () => {
    context.platformMembershipService.listPlans.mockResolvedValue([
      {
        id: 'monthly',
        name: '月度会员',
        price: 4800,
        originalPrice: 4800,
        durationMonths: 1,
        monthlyPrice: 4800,
      },
    ]);

    await expect(context.service.listPlans()).resolves.toEqual([
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
    context.pulseStoreContextService.resolveTargetStoreOrThrow.mockResolvedValue(
      {
        id: 18,
        name: '纯利宝南山店',
        address: '深圳市南山区',
        contactPhone: '0755-12345678',
        ownerId: 301,
        ownerName: '张三',
      },
    );
    context.platformMembershipService.getCenterByStoreId.mockResolvedValue({
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

    const result = await context.service.getCenter(context.user);

    expect(
      context.pulseStoreContextService.resolveTargetStoreOrThrow,
    ).toHaveBeenCalledWith(context.user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看订阅中心',
    });
    expect(
      context.platformMembershipService.getCenterByStoreId,
    ).toHaveBeenCalledWith(18);
    expect(result.paidOrderCount).toBe(4);
  });

  it('previewOrder 使用平台会员配置表中的套餐价格', async () => {
    context.pulseStoreContextService.resolveTargetStoreOrThrow.mockResolvedValue(
      {
        id: 18,
        name: '纯利宝南山店',
        address: '深圳市南山区',
        contactPhone: '0755-12345678',
        ownerId: 301,
        ownerName: '张三',
      },
    );
    context.platformMembershipService.getPlanConfig.mockResolvedValue({
      id: 'quarterly',
      name: '季度会员',
      price: 12300,
      originalPrice: 12300,
      durationMonths: 3,
      monthlyPrice: 4100,
      badge: '新价格',
      recommended: true,
    });
    context.prismaService.storeMembershipProfile.findFirst.mockResolvedValue({
      availablePoints: 500,
    });
    context.prismaService.storePartner.findFirst.mockResolvedValue({
      beanBalance: 20,
    });

    await expect(
      context.service.previewOrder(context.user, {
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
    expect(
      context.platformMembershipService.getPlanConfig,
    ).toHaveBeenCalledWith('quarterly');
  });

  it('purchaseOrder 在观察态下显式拒绝代商家创建订单', async () => {
    context.pulseStoreContextService.resolveTargetStoreOrThrow.mockResolvedValue(
      {
        id: 18,
        name: '纯利宝南山店',
        address: '深圳市南山区',
        contactPhone: '0755-12345678',
        ownerId: 301,
        ownerName: '张三',
      },
    );

    await expect(
      context.service.purchaseOrder(context.user, {
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
});
