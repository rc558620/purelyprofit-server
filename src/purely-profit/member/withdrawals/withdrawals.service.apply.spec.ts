import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PartnerWithdrawalStatus } from '@prisma/client';
import {
  createApplyPartner,
  createOverviewPartner,
  createWithdrawalRecord,
  createWithdrawalsServiceTestingContext,
  type WithdrawalsServiceTestingContext,
} from './withdrawals.service.test-setup';

describe('WithdrawalsService apply', () => {
  let context: WithdrawalsServiceTestingContext;

  beforeEach(async () => {
    context = await createWithdrawalsServiceTestingContext();
  });

  it('apply 在当前账号未通过合伙人审核时拒绝提交', async () => {
    context.prismaService.storePartner.findFirst.mockResolvedValue(
      createApplyPartner({ status: 'pending' }),
    );

    await expect(
      context.service.apply(context.user, {
        beanAmount: 500,
        accountType: 'wechat',
        accountNo: 'wxid_abc123',
        accountName: '张三',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('apply 在提现金额低于 100 豆时拒绝提交', async () => {
    await expect(
      context.service.apply(context.user, {
        beanAmount: 99,
        accountType: 'wechat',
        accountNo: 'wxid_abc123',
        accountName: '张三',
      }),
    ).rejects.toThrow('最低提现 100 豆');

    expect(
      context.prismaService.storePartner.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('apply 在余额不足时阻止提现', async () => {
    context.prismaService.storePartner.findFirst.mockResolvedValue(
      createApplyPartner({ beanBalance: 300 }),
    );

    await expect(
      context.service.apply(context.user, {
        beanAmount: 500,
        accountType: 'wechat',
        accountNo: 'wxid_abc123',
        accountName: '张三',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('相同幂等键重复提交时重放已有记录，不重复扣豆或建单', async () => {
    context.prismaService.storePartner.findFirst.mockResolvedValue(
      createApplyPartner(),
    );
    context.prismaService.partnerWithdrawal.findFirst.mockResolvedValue(
      createWithdrawalRecord({
        id: 99,
        beanAmount: 500,
        status: PartnerWithdrawalStatus.pending,
        appliedAt: new Date(),
      }),
    );

    const result = await context.service.apply(
      context.user,
      {
        beanAmount: 500,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
      },
      'same-key',
    );

    expect(result.record.id).toBe('99');
    expect(
      context.prismaService.storePartner.updateMany,
    ).not.toHaveBeenCalled();
    expect(
      context.prismaService.partnerWithdrawal.create,
    ).not.toHaveBeenCalled();
  });

  it('不同幂等键的同额二次申请不再被时间窗口误拒', async () => {
    context.prismaService.storePartner.findFirst.mockResolvedValue(
      createApplyPartner(),
    );
    context.prismaService.partnerWithdrawal.findFirst.mockResolvedValue(null);
    context.prismaService.storePartner.updateMany.mockResolvedValue({
      count: 1,
    });
    context.prismaService.partnerWithdrawal.create.mockResolvedValue(
      createWithdrawalRecord({ id: 21 }),
    );
    context.prismaService.partnerWithdrawal.count.mockResolvedValue(2);

    const payload = {
      beanAmount: 500,
      accountType: 'alipay' as const,
      accountNo: '13800138000',
      accountName: '张三',
    };
    await context.service.apply(context.user, payload, 'key-a');
    await context.service.apply(context.user, payload, 'key-b');

    expect(
      context.prismaService.partnerWithdrawal.create,
    ).toHaveBeenCalledTimes(2);
  });

  it('apply 提现成功时扣减余额、累加累计提现并返回前端所需字段', async () => {
    const applyPartner = createApplyPartner();
    const overviewPartner = createOverviewPartner({
      beanBalance: 700,
      totalWithdrawnBeans: 1300,
    });

    context.prismaService.storePartner.findFirst
      .mockResolvedValueOnce(applyPartner)
      .mockResolvedValueOnce(overviewPartner);
    context.prismaService.storePartner.updateMany.mockResolvedValue({
      count: 1,
    });
    context.prismaService.partnerWithdrawal.create.mockResolvedValue(
      createWithdrawalRecord({
        id: 21,
        accountType: 'alipay',
        accountNo: '13800138000',
      }),
    );
    context.prismaService.partnerWithdrawal.count.mockResolvedValue(3);

    await expect(
      context.service.apply(context.user, {
        beanAmount: 500,
        accountType: 'alipay',
        accountNo: ' 13800138000 ',
        accountName: ' 张三 ',
      }),
    ).resolves.toEqual({
      record: {
        id: '21',
        beanAmount: 500,
        rmbAmount: 50000,
        netRmbAmount: 50000,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
        status: 'pending',
        appliedAt: new Date('2026-05-14T10:00:00.000Z').getTime(),
      },
      overview: {
        approvedPartner: {
          id: '6',
          name: '张三',
          phone: '13800138000',
          joinedAt: overviewPartner.joinedAt.getTime(),
          beanBalance: 700,
          totalEarnedBeans: 2000,
          totalWithdrawnBeans: 1300,
        },
        approvedPartners: [
          {
            id: '6',
            name: '张三',
            phone: '13800138000',
            joinedAt: overviewPartner.joinedAt.getTime(),
            beanBalance: 700,
            totalEarnedBeans: 2000,
            totalWithdrawnBeans: 1300,
          },
        ],
        beanBalance: 700,
        totalWithdrawnBeans: 1300,
        pendingBeans: 0,
        pendingCount: 3,
      },
    });

    expect(context.prismaService.storePartner.updateMany).toHaveBeenCalledWith({
      where: {
        id: 6,
        status: 'approved',
        beanBalance: { gte: 500 },
      },
      data: {
        beanBalance: { decrement: 500 },
        totalWithdrawnBeans: { increment: 500 },
        paymentAccountType: 'alipay',
        paymentAccountNo: '13800138000',
        paymentAccountName: '张三',
      },
    });
    const createCall = context.prismaService.partnerWithdrawal.create.mock
      .calls[0] as [
      {
        data: {
          storeId: number;
          partnerId: number;
          operatorStaffId: number | null;
          beanAmount: number;
          rmbAmount: number;
          accountType: string;
          accountNo: string;
          accountName: string;
          status: string;
        };
        select: Record<string, boolean>;
      },
    ];

    expect(createCall[0].data).toEqual({
      storeId: 18,
      partnerId: 6,
      operatorStaffId: 8,
      idempotencyKey: expect.any(String),
      beanAmount: 500,
      rmbAmount: 50000,
      accountType: 'alipay',
      accountNo: '13800138000',
      accountName: '张三',
      status: 'pending',
    });
    expect(createCall[0].select).toBeDefined();
    expect(
      context.prismaService.storePartnerBeanLog.create,
    ).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        partnerId: 6,
        source: 'withdrawal',
        changeAmount: -500,
        description: '提现申请 · 500 豆',
      },
    });
  });

  it('apply 的重复申请查重在事务内执行，避免被并发请求穿透', async () => {
    context.prismaService.storePartner.findFirst.mockResolvedValue(
      createApplyPartner(),
    );
    context.prismaService.storePartner.updateMany.mockResolvedValue({
      count: 1,
    });
    context.prismaService.partnerWithdrawal.create.mockResolvedValue(
      createWithdrawalRecord({ id: 21 }),
    );
    context.prismaService.partnerWithdrawal.count.mockResolvedValue(1);

    await context.service.apply(context.user, {
      beanAmount: 500,
      accountType: 'wechat',
      accountNo: 'wxid_abc123',
      accountName: '张三',
    });

    const duplicateCheckOrder =
      context.prismaService.partnerWithdrawal.findFirst.mock
        .invocationCallOrder[0];
    const transactionOrder =
      context.prismaService.$transaction.mock.invocationCallOrder[0];
    expect(duplicateCheckOrder).toBeGreaterThan(transactionOrder);
  });

  it('apply 在锁保护下执行且无论成功失败都释放锁', async () => {
    context.prismaService.storePartner.findFirst.mockResolvedValue(
      createApplyPartner(),
    );
    context.prismaService.storePartner.updateMany.mockResolvedValue({
      count: 1,
    });
    context.prismaService.partnerWithdrawal.create.mockRejectedValueOnce(
      new Error('db down'),
    );

    await expect(
      context.service.apply(context.user, {
        beanAmount: 500,
        accountType: 'wechat',
        accountNo: 'wxid_abc123',
        accountName: '张三',
      }),
    ).rejects.toThrow('db down');

    expect(context.redisLockService.acquireLock).toHaveBeenCalledWith(
      'withdrawals:apply:store:18:partner:6',
      expect.objectContaining({ ttlSeconds: expect.any(Number) }),
    );
    expect(context.redisLockService.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('apply 获取锁失败时拒绝提交且不落库', async () => {
    context.prismaService.storePartner.findFirst.mockResolvedValue(
      createApplyPartner(),
    );
    context.redisLockService.acquireLock.mockResolvedValueOnce(null);

    await expect(
      context.service.apply(context.user, {
        beanAmount: 500,
        accountType: 'wechat',
        accountNo: 'wxid_abc123',
        accountName: '张三',
      }),
    ).rejects.toThrow('提现申请正在处理中，请稍后重试');

    expect(
      context.prismaService.partnerWithdrawal.create,
    ).not.toHaveBeenCalled();
  });

  it('apply 成功后失效提现、豆子中心、合伙人资料与 pulse 打款列表的全部派生缓存', async () => {
    context.prismaService.storePartner.findFirst
      .mockResolvedValueOnce(createApplyPartner())
      .mockResolvedValueOnce(createOverviewPartner());
    context.prismaService.storePartner.updateMany.mockResolvedValue({
      count: 1,
    });
    context.prismaService.partnerWithdrawal.create.mockResolvedValue(
      createWithdrawalRecord({ id: 21 }),
    );
    context.prismaService.partnerWithdrawal.count.mockResolvedValue(1);

    await context.service.apply(context.user, {
      beanAmount: 500,
      accountType: 'wechat',
      accountNo: 'wxid_abc123',
      accountName: '张三',
    });

    expect(
      context.cacheInvalidatorService.invalidateWithdrawalsDerived,
    ).toHaveBeenCalledWith(18);
    expect(
      context.cacheInvalidatorService.invalidatePlatformMembershipDerived,
    ).toHaveBeenCalledWith(18);
    expect(
      context.cacheInvalidatorService.invalidateDashboardAndPulseSession,
    ).toHaveBeenCalledWith(18);
    expect(
      context.cacheInvalidatorService.invalidatePulseGrowthEarnings,
    ).toHaveBeenCalledWith(18);
    // 商家端提交后 pulse 合伙人打款列表必须立刻回源，否则 30s 内仍是空列表
    expect(
      context.cacheInvalidatorService.invalidatePulseGrowthAdminQueries,
    ).toHaveBeenCalledTimes(1);
  });
});
