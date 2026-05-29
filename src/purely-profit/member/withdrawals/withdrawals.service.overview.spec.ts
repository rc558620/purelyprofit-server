import {
  createOverviewPartner,
  createWithdrawalRecord,
  createWithdrawalsServiceTestingContext,
  type WithdrawalsServiceTestingContext,
} from './withdrawals.service.test-setup';

describe('WithdrawalsService overview and list', () => {
  let context: WithdrawalsServiceTestingContext;

  beforeEach(async () => {
    context = await createWithdrawalsServiceTestingContext();
  });

  it('getOverview 在当前门店没有合伙人档案时返回零值汇总', async () => {
    context.prismaService.storePartner.findMany.mockResolvedValue([]);
    context.prismaService.partnerWithdrawal.count.mockResolvedValue(2);

    await expect(context.service.getOverview(context.user)).resolves.toEqual({
      approvedPartner: null,
      approvedPartners: [],
      beanBalance: 0,
      totalWithdrawnBeans: 0,
      pendingCount: 2,
    });
  });

  it('getOverview 返回审批通过合伙人的余额与处理中数量', async () => {
    const partner = createOverviewPartner();
    context.prismaService.storePartner.findMany.mockResolvedValue([partner]);
    context.prismaService.partnerWithdrawal.count.mockResolvedValue(1);

    await expect(context.service.getOverview(context.user)).resolves.toEqual({
      approvedPartner: {
        id: '6',
        name: '张三',
        phone: '13800138000',
        joinedAt: partner.joinedAt.getTime(),
        beanBalance: 1200,
        totalEarnedBeans: 2000,
        totalWithdrawnBeans: 800,
      },
      approvedPartners: [
        {
          id: '6',
          name: '张三',
          phone: '13800138000',
          joinedAt: partner.joinedAt.getTime(),
          beanBalance: 1200,
          totalEarnedBeans: 2000,
          totalWithdrawnBeans: 800,
        },
      ],
      beanBalance: 1200,
      totalWithdrawnBeans: 800,
      pendingCount: 1,
    });
  });

  it('list 默认按当前门店查询并映射前端字段', async () => {
    context.prismaService.partnerWithdrawal.findMany.mockResolvedValue([
      createWithdrawalRecord({
        id: 15,
        accountType: 'alipay',
        accountNo: '13800138000',
      }),
    ]);

    await expect(context.service.list(context.user, {})).resolves.toEqual([
      {
        id: '15',
        beanAmount: 500,
        rmbAmount: 50000,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
        status: 'pending',
        appliedAt: new Date('2026-05-14T10:00:00.000Z').getTime(),
      },
    ]);

    const findManyCall = context.prismaService.partnerWithdrawal.findMany.mock
      .calls[0] as [
      {
        where: { storeId: number };
        select: Record<string, boolean>;
        orderBy: Array<{ appliedAt?: 'desc'; id?: 'desc' }>;
      },
    ];

    expect(findManyCall[0].where).toEqual({ storeId: 18 });
    expect(findManyCall[0].orderBy).toEqual([
      { appliedAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(findManyCall[0].select).toBeDefined();
  });
});
