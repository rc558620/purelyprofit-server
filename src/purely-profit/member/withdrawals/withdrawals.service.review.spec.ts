import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PartnerWithdrawalStatus } from '@prisma/client';
import {
  createOverviewPartner,
  createWithdrawalRecord,
  createWithdrawalsServiceTestingContext,
  type WithdrawalsServiceTestingContext,
} from './withdrawals.service.test-setup';

describe('WithdrawalsService review actions', () => {
  let context: WithdrawalsServiceTestingContext;

  beforeEach(async () => {
    context = await createWithdrawalsServiceTestingContext();
  });

  it('approve 通过待审核记录时写入 approved 和 reviewedAt', async () => {
    context.prismaService.partnerWithdrawal.findUnique
      .mockResolvedValueOnce(createWithdrawalRecord({ id: 31 }))
      .mockResolvedValueOnce(
        createWithdrawalRecord({
          id: 31,
          status: PartnerWithdrawalStatus.approved,
          reviewedAt: new Date('2026-05-15T10:00:00.000Z'),
        }),
      );
    context.prismaService.partnerWithdrawal.updateMany.mockResolvedValue({
      count: 1,
    });
    context.prismaService.storePartner.findUnique.mockResolvedValue(
      createOverviewPartner({
        beanBalance: 700,
        totalWithdrawnBeans: 1300,
      }),
    );
    context.prismaService.partnerWithdrawal.count.mockResolvedValue(2);

    const result = await context.service.approve(context.user, 31);

    const approveCall = context.prismaService.partnerWithdrawal.updateMany.mock
      .calls[0] as [
      {
        where: {
          id: number;
          storeId: number;
          status: PartnerWithdrawalStatus;
        };
        data: {
          status: PartnerWithdrawalStatus;
          reviewedAt: Date;
          rejectReason: null;
        };
      },
    ];

    expect(approveCall[0].where).toEqual({
      id: 31,
      storeId: 18,
      status: PartnerWithdrawalStatus.pending,
    });
    expect(approveCall[0].data.status).toBe(PartnerWithdrawalStatus.approved);
    expect(approveCall[0].data.reviewedAt).toBeInstanceOf(Date);
    expect(approveCall[0].data.rejectReason).toBeNull();
    expect(result.record.status).toBe('approved');
    expect(result.record.reviewedAt).toBeDefined();
    expect(result.overview.pendingCount).toBe(2);
  });

  it('reject 拒绝待审核记录时退回纯利豆并写入拒绝原因', async () => {
    context.prismaService.partnerWithdrawal.findUnique
      .mockResolvedValueOnce(
        createWithdrawalRecord({
          id: 32,
          accountType: 'alipay',
          accountNo: '13800138000',
        }),
      )
      .mockResolvedValueOnce(
        createWithdrawalRecord({
          id: 32,
          accountType: 'alipay',
          accountNo: '13800138000',
          status: PartnerWithdrawalStatus.rejected,
          reviewedAt: new Date('2026-05-15T11:00:00.000Z'),
          rejectReason: '账户信息不匹配',
        }),
      );
    context.prismaService.partnerWithdrawal.updateMany.mockResolvedValue({
      count: 1,
    });
    context.prismaService.storePartner.updateMany.mockResolvedValue({
      count: 1,
    });
    context.prismaService.storePartner.findUnique.mockResolvedValue(
      createOverviewPartner(),
    );
    context.prismaService.partnerWithdrawal.count.mockResolvedValue(1);

    const result = await context.service.reject(context.user, 32, {
      reason: ' 账户信息不匹配 ',
    });

    const rejectCall = context.prismaService.partnerWithdrawal.updateMany.mock
      .calls[0] as [
      {
        where: {
          id: number;
          storeId: number;
          status: PartnerWithdrawalStatus;
        };
        data: {
          status: PartnerWithdrawalStatus;
          reviewedAt: Date;
          rejectReason: string;
        };
      },
    ];

    expect(rejectCall[0].where).toEqual({
      id: 32,
      storeId: 18,
      status: PartnerWithdrawalStatus.pending,
    });
    expect(rejectCall[0].data.status).toBe(PartnerWithdrawalStatus.rejected);
    expect(rejectCall[0].data.reviewedAt).toBeInstanceOf(Date);
    expect(rejectCall[0].data.rejectReason).toBe('账户信息不匹配');
    expect(context.prismaService.storePartner.updateMany).toHaveBeenCalledWith({
      where: {
        id: 6,
        storeId: 18,
        totalWithdrawnBeans: { gte: 500 },
      },
      data: {
        beanBalance: { increment: 500 },
        totalWithdrawnBeans: { decrement: 500 },
      },
    });
    expect(
      context.prismaService.storePartnerBeanLog.create,
    ).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        partnerId: 6,
        source: 'admin_adjust',
        changeAmount: 500,
        description: '提现退回 · 500 豆已退回',
      },
    });
    expect(result.record.status).toBe('rejected');
    expect(result.record.rejectReason).toBe('账户信息不匹配');
  });

  it('pay 仅允许 approved 状态进入已打款', async () => {
    context.prismaService.partnerWithdrawal.findUnique
      .mockResolvedValueOnce(
        createWithdrawalRecord({
          id: 33,
          accountType: 'bank',
          accountNo: '6222020202020202',
          status: PartnerWithdrawalStatus.approved,
          reviewedAt: new Date('2026-05-15T10:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        createWithdrawalRecord({
          id: 33,
          accountType: 'bank',
          accountNo: '6222020202020202',
          status: PartnerWithdrawalStatus.paid,
          reviewedAt: new Date('2026-05-15T10:00:00.000Z'),
          paidAt: new Date('2026-05-15T18:00:00.000Z'),
        }),
      );
    context.prismaService.partnerWithdrawal.updateMany.mockResolvedValue({
      count: 1,
    });
    context.prismaService.storePartner.findUnique.mockResolvedValue(
      createOverviewPartner({
        beanBalance: 700,
        totalWithdrawnBeans: 1300,
      }),
    );
    context.prismaService.partnerWithdrawal.count.mockResolvedValue(0);

    const result = await context.service.pay(context.user, 33);

    const payCall = context.prismaService.partnerWithdrawal.updateMany.mock
      .calls[0] as [
      {
        where: {
          id: number;
          storeId: number;
          status: PartnerWithdrawalStatus;
        };
        data: {
          status: PartnerWithdrawalStatus;
          paidAt: Date;
        };
      },
    ];

    expect(payCall[0].where).toEqual({
      id: 33,
      storeId: 18,
      status: PartnerWithdrawalStatus.approved,
    });
    expect(payCall[0].data.status).toBe(PartnerWithdrawalStatus.paid);
    expect(payCall[0].data.paidAt).toBeInstanceOf(Date);
    expect(result.record.status).toBe('paid');
    expect(result.record.paidAt).toBeDefined();
  });

  it('approve 在记录不属于当前门店时抛出无权异常', async () => {
    context.prismaService.partnerWithdrawal.findUnique.mockResolvedValue(
      createWithdrawalRecord({ id: 34, storeId: 99 }),
    );

    await expect(
      context.service.approve(context.user, 34),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('pay 在记录不存在时抛出不存在异常', async () => {
    context.prismaService.partnerWithdrawal.findUnique.mockResolvedValue(null);

    await expect(context.service.pay(context.user, 999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reject 在状态不是 pending 时拒绝执行', async () => {
    context.prismaService.partnerWithdrawal.findUnique.mockResolvedValue(
      createWithdrawalRecord({
        id: 35,
        status: PartnerWithdrawalStatus.approved,
        reviewedAt: new Date('2026-05-15T10:00:00.000Z'),
      }),
    );

    await expect(
      context.service.reject(context.user, 35, { reason: '重复申请' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
