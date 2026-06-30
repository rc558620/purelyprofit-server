import {
  createPulseMembershipServiceTestingContext,
  type PulseMembershipServiceTestingContext,
} from './membership.service.test-setup';

describe('PulseMembershipService ledger', () => {
  let context: PulseMembershipServiceTestingContext;

  beforeEach(async () => {
    jest.clearAllMocks();
    context = await createPulseMembershipServiceTestingContext();
  });

  it('listPointsLogs 在开发者未选门店时返回聚合积分流水', async () => {
    context.pulseStoreContextService.resolveTargetStore.mockResolvedValue({
      store: null,
      source: null,
    });
    context.prismaService.storeMembershipProfile.findMany.mockResolvedValue([
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
    context.prismaService.storeMembershipPointsLog.findMany.mockResolvedValue([
      {
        id: 21,
        source: 'purchase_bonus',
        changeType: 'increase',
        changeAmount: 100,
        description: '购买会员赠送积分',
        expireAt: new Date('2027-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-21T10:00:00.000Z'),
      },
      {
        id: 22,
        source: 'expire',
        changeType: 'decrease',
        changeAmount: 30,
        description: '积分过期扣减',
        expireAt: null,
        createdAt: new Date('2026-05-20T10:00:00.000Z'),
      },
    ]);

    const result = await context.service.listPointsLogs(context.user);

    expect(
      context.pulseStoreContextService.resolveTargetStore,
    ).toHaveBeenCalledWith(context.user);
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
        currentPlanId: true,
        expiresAt: true,
        totalPoints: true,
        availablePoints: true,
      },
    });
    expect(
      context.prismaService.storeMembershipPointsLog.findMany,
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
        id: true,
        source: true,
        changeType: true,
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
    context.pulseStoreContextService.resolveTargetStore.mockResolvedValue({
      store: null,
      source: null,
    });
    context.prismaService.storePartner.findMany.mockResolvedValue([
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
    context.prismaService.storePartnerBeanLog.findMany.mockResolvedValue([
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

    const result = await context.service.listBeanLogs(context.user);

    expect(
      context.pulseStoreContextService.resolveTargetStore,
    ).toHaveBeenCalledWith(context.user);
    expect(context.prismaService.storePartner.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
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
    expect(
      context.prismaService.storePartnerBeanLog.findMany,
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
      approvedPartners: [],
      overview: {
        beanBalance: 20,
        totalEarnedBeans: 50,
        totalWithdrawnBeans: 8,
        pendingBeans: 22,
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
          relatedPromoId: undefined,
          relatedPlanType: undefined,
          relatedUser: undefined,
          createdAt: new Date('2026-05-20T10:00:00.000Z').getTime(),
        },
      ],
    });
  });
});
