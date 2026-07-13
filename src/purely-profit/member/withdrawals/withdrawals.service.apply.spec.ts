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

  it('apply 在短时间窗口内同合伙人同金额重复提交时被拒绝且不生成记录', async () => {
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

    await expect(
      context.service.apply(context.user, {
        beanAmount: 500,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
      }),
    ).rejects.toThrow('请勿重复提交提现申请');

    expect(
      context.prismaService.partnerWithdrawal.create,
    ).not.toHaveBeenCalled();
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
});
