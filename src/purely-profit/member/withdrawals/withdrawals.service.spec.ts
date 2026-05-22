import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PartnerWithdrawalStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { WithdrawalsService } from './withdrawals.service';

describe('WithdrawalsService', () => {
  let service: WithdrawalsService;

  const prismaService = {
    storePartner: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    storePartnerBeanLog: {
      create: jest.fn(),
    },
    partnerWithdrawal: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
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
    jest.resetAllMocks();
    prismaService.$transaction.mockImplementation(
      async (
        callback: (transactionClient: typeof prismaService) => Promise<unknown>,
      ) => callback(prismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawalsService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<WithdrawalsService>(WithdrawalsService);
  });

  it('getOverview 在当前门店没有合伙人档案时返回零值汇总', async () => {
    prismaService.storePartner.findUnique.mockResolvedValue(null);
    prismaService.partnerWithdrawal.count.mockResolvedValue(2);

    await expect(service.getOverview(user)).resolves.toEqual({
      beanBalance: 0,
      totalWithdrawnBeans: 0,
      pendingCount: 2,
    });
  });

  it('getOverview 返回审批通过合伙人的余额与处理中数量', async () => {
    prismaService.storePartner.findUnique.mockResolvedValue({
      status: 'approved',
      beanBalance: 1200,
      totalWithdrawnBeans: 800,
    });
    prismaService.partnerWithdrawal.count.mockResolvedValue(1);

    await expect(service.getOverview(user)).resolves.toEqual({
      beanBalance: 1200,
      totalWithdrawnBeans: 800,
      pendingCount: 1,
    });
  });

  it('list 默认按当前门店查询并映射前端字段', async () => {
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([
      {
        id: 15,
        storeId: 18,
        partnerId: 6,
        beanAmount: 500,
        rmbAmount: 50000,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
        status: 'pending',
        appliedAt: new Date('2026-05-14T10:00:00.000Z'),
        reviewedAt: null,
        paidAt: null,
        rejectReason: null,
      },
    ]);

    await expect(service.list(user, {})).resolves.toEqual([
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

    const findManyCall = prismaService.partnerWithdrawal.findMany.mock
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

  it('apply 在当前账号未通过合伙人审核时拒绝提交', async () => {
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 6,
      status: 'pending',
      beanBalance: 1200,
    });

    await expect(
      service.apply(user, {
        beanAmount: 500,
        accountType: 'wechat',
        accountNo: 'wxid_abc123',
        accountName: '张三',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('apply 在提现金额低于 100 豆时拒绝提交', async () => {
    await expect(
      service.apply(user, {
        beanAmount: 99,
        accountType: 'wechat',
        accountNo: 'wxid_abc123',
        accountName: '张三',
      }),
    ).rejects.toThrow('最低提现 100 豆');

    expect(prismaService.storePartner.findUnique).not.toHaveBeenCalled();
  });

  it('apply 在余额不足时阻止提现', async () => {
    prismaService.storePartner.findUnique.mockResolvedValue({
      id: 6,
      status: 'approved',
      beanBalance: 300,
    });

    await expect(
      service.apply(user, {
        beanAmount: 500,
        accountType: 'wechat',
        accountNo: 'wxid_abc123',
        accountName: '张三',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('apply 提现成功时扣减余额、累加累计提现并返回前端所需字段', async () => {
    prismaService.storePartner.findUnique
      .mockResolvedValueOnce({
        id: 6,
        status: 'approved',
        beanBalance: 1200,
      })
      .mockResolvedValueOnce({
        status: 'approved',
        beanBalance: 700,
        totalWithdrawnBeans: 1300,
      });
    prismaService.storePartner.updateMany.mockResolvedValue({ count: 1 });
    prismaService.partnerWithdrawal.create.mockResolvedValue({
      id: 21,
      storeId: 18,
      partnerId: 6,
      beanAmount: 500,
      rmbAmount: 50000,
      accountType: 'alipay',
      accountNo: '13800138000',
      accountName: '张三',
      status: PartnerWithdrawalStatus.pending,
      appliedAt: new Date('2026-05-14T10:00:00.000Z'),
      reviewedAt: null,
      paidAt: null,
      rejectReason: null,
    });
    prismaService.partnerWithdrawal.count.mockResolvedValue(3);

    await expect(
      service.apply(user, {
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
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
        status: 'pending',
        appliedAt: new Date('2026-05-14T10:00:00.000Z').getTime(),
      },
      overview: {
        beanBalance: 700,
        totalWithdrawnBeans: 1300,
        pendingCount: 3,
      },
    });

    expect(prismaService.storePartner.updateMany).toHaveBeenCalledWith({
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
    const createCall = prismaService.partnerWithdrawal.create.mock.calls[0] as [
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
    expect(prismaService.storePartnerBeanLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        partnerId: 6,
        source: 'withdrawal',
        changeAmount: -500,
        description: '提现申请 · ¥500',
      },
    });
  });

  it('approve 通过待审核记录时写入 approved 和 reviewedAt', async () => {
    prismaService.partnerWithdrawal.findUnique
      .mockResolvedValueOnce({
        id: 31,
        storeId: 18,
        partnerId: 6,
        beanAmount: 500,
        rmbAmount: 50000,
        accountType: 'wechat',
        accountNo: 'wxid_abc',
        accountName: '张三',
        status: PartnerWithdrawalStatus.pending,
        appliedAt: new Date('2026-05-14T10:00:00.000Z'),
        reviewedAt: null,
        paidAt: null,
        rejectReason: null,
      })
      .mockResolvedValueOnce({
        id: 31,
        storeId: 18,
        partnerId: 6,
        beanAmount: 500,
        rmbAmount: 50000,
        accountType: 'wechat',
        accountNo: 'wxid_abc',
        accountName: '张三',
        status: PartnerWithdrawalStatus.approved,
        appliedAt: new Date('2026-05-14T10:00:00.000Z'),
        reviewedAt: new Date('2026-05-15T10:00:00.000Z'),
        paidAt: null,
        rejectReason: null,
      });
    prismaService.partnerWithdrawal.updateMany.mockResolvedValue({ count: 1 });
    prismaService.storePartner.findUnique.mockResolvedValue({
      status: 'approved',
      beanBalance: 700,
      totalWithdrawnBeans: 1300,
    });
    prismaService.partnerWithdrawal.count.mockResolvedValue(2);

    const result = await service.approve(user, 31);

    const approveCall = prismaService.partnerWithdrawal.updateMany.mock
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
    prismaService.partnerWithdrawal.findUnique
      .mockResolvedValueOnce({
        id: 32,
        storeId: 18,
        partnerId: 6,
        beanAmount: 500,
        rmbAmount: 50000,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
        status: PartnerWithdrawalStatus.pending,
        appliedAt: new Date('2026-05-14T10:00:00.000Z'),
        reviewedAt: null,
        paidAt: null,
        rejectReason: null,
      })
      .mockResolvedValueOnce({
        id: 32,
        storeId: 18,
        partnerId: 6,
        beanAmount: 500,
        rmbAmount: 50000,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
        status: PartnerWithdrawalStatus.rejected,
        appliedAt: new Date('2026-05-14T10:00:00.000Z'),
        reviewedAt: new Date('2026-05-15T11:00:00.000Z'),
        paidAt: null,
        rejectReason: '账户信息不匹配',
      });
    prismaService.partnerWithdrawal.updateMany.mockResolvedValue({ count: 1 });
    prismaService.storePartner.updateMany.mockResolvedValue({ count: 1 });
    prismaService.storePartner.findUnique.mockResolvedValue({
      status: 'approved',
      beanBalance: 1200,
      totalWithdrawnBeans: 800,
    });
    prismaService.partnerWithdrawal.count.mockResolvedValue(1);

    const result = await service.reject(user, 32, {
      reason: ' 账户信息不匹配 ',
    });

    const rejectCall = prismaService.partnerWithdrawal.updateMany.mock
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
    expect(prismaService.storePartner.updateMany).toHaveBeenCalledWith({
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
    expect(prismaService.storePartnerBeanLog.create).toHaveBeenCalledWith({
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
    prismaService.partnerWithdrawal.findUnique
      .mockResolvedValueOnce({
        id: 33,
        storeId: 18,
        partnerId: 6,
        beanAmount: 500,
        rmbAmount: 50000,
        accountType: 'bank',
        accountNo: '6222020202020202',
        accountName: '张三',
        status: PartnerWithdrawalStatus.approved,
        appliedAt: new Date('2026-05-14T10:00:00.000Z'),
        reviewedAt: new Date('2026-05-15T10:00:00.000Z'),
        paidAt: null,
        rejectReason: null,
      })
      .mockResolvedValueOnce({
        id: 33,
        storeId: 18,
        partnerId: 6,
        beanAmount: 500,
        rmbAmount: 50000,
        accountType: 'bank',
        accountNo: '6222020202020202',
        accountName: '张三',
        status: PartnerWithdrawalStatus.paid,
        appliedAt: new Date('2026-05-14T10:00:00.000Z'),
        reviewedAt: new Date('2026-05-15T10:00:00.000Z'),
        paidAt: new Date('2026-05-15T18:00:00.000Z'),
        rejectReason: null,
      });
    prismaService.partnerWithdrawal.updateMany.mockResolvedValue({ count: 1 });
    prismaService.storePartner.findUnique.mockResolvedValue({
      status: 'approved',
      beanBalance: 700,
      totalWithdrawnBeans: 1300,
    });
    prismaService.partnerWithdrawal.count.mockResolvedValue(0);

    const result = await service.pay(user, 33);

    const payCall = prismaService.partnerWithdrawal.updateMany.mock
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
    prismaService.partnerWithdrawal.findUnique.mockResolvedValue({
      id: 34,
      storeId: 99,
      partnerId: 6,
      beanAmount: 500,
      rmbAmount: 50000,
      accountType: 'wechat',
      accountNo: 'wxid_abc',
      accountName: '张三',
      status: PartnerWithdrawalStatus.pending,
      appliedAt: new Date('2026-05-14T10:00:00.000Z'),
      reviewedAt: null,
      paidAt: null,
      rejectReason: null,
    });

    await expect(service.approve(user, 34)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('pay 在记录不存在时抛出不存在异常', async () => {
    prismaService.partnerWithdrawal.findUnique.mockResolvedValue(null);

    await expect(service.pay(user, 999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reject 在状态不是 pending 时拒绝执行', async () => {
    prismaService.partnerWithdrawal.findUnique.mockResolvedValue({
      id: 35,
      storeId: 18,
      partnerId: 6,
      beanAmount: 500,
      rmbAmount: 50000,
      accountType: 'wechat',
      accountNo: 'wxid_abc',
      accountName: '张三',
      status: PartnerWithdrawalStatus.approved,
      appliedAt: new Date('2026-05-14T10:00:00.000Z'),
      reviewedAt: new Date('2026-05-15T10:00:00.000Z'),
      paidAt: null,
      rejectReason: null,
    });

    await expect(
      service.reject(user, 35, { reason: '重复申请' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
