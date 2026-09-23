import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
  NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
  NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
} from './new-customer-quota.constants';
import { NewCustomerQuotaService } from './new-customer-quota.service';

/** 构造唯一约束冲突（同店同手机号重复扣减） */
const buildUniqueConstraintError = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('duplicate key', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('NewCustomerQuotaService', () => {
  let service: NewCustomerQuotaService;

  /** 事务内外共用同一批 delegate：事务内传入的就是这份 mock */
  const delegates = {
    storeMembershipProfile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    storeNewCustomerQuotaLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    storeNewCustomerQuotaConsume: {
      create: jest.fn(),
    },
    marketingCustomer: {
      findFirst: jest.fn(),
    },
  };

  const prismaService = {
    ...delegates,
    $transaction: jest.fn((fn: (tx: typeof delegates) => Promise<unknown>) =>
      fn(delegates),
    ),
  };

  /** 让 getOverview 返回指定余额：findUnique + 两条 aggregate */
  const mockOverviewRead = (remaining: number, consumed: number): void => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: remaining,
      newCustomerQuotaConsumed: consumed,
    });
    delegates.storeNewCustomerQuotaLog.aggregate.mockResolvedValue({
      _sum: { changeAmount: 0 },
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewCustomerQuotaService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<NewCustomerQuotaService>(NewCustomerQuotaService);
  });

  it('门店无会员档案时概览全部归零，预警阈值取默认 100', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue(null);
    delegates.storeNewCustomerQuotaLog.aggregate.mockResolvedValue({
      _sum: { changeAmount: null },
    });

    await expect(service.getOverview(42)).resolves.toEqual({
      storeId: 42,
      remaining: 0,
      warningThreshold: NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
      totalRecharged: 0,
      totalGranted: 0,
      totalConsumed: 0,
    });
  });

  it('有余额时汇总充值/赠送/已服务新客', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 86,
      newCustomerQuotaConsumed: 547,
    });
    delegates.storeNewCustomerQuotaLog.aggregate
      .mockResolvedValueOnce({ _sum: { changeAmount: 333 } })
      .mockResolvedValueOnce({ _sum: { changeAmount: 300 } });

    await expect(service.getOverview(42)).resolves.toEqual({
      storeId: 42,
      remaining: 86,
      warningThreshold: NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
      totalRecharged: 333,
      totalGranted: 300,
      totalConsumed: 547,
    });
  });

  it('充值档位：金额与新客数都由后端计算（0.03 元/位新客）', () => {
    expect(service.getTiers()).toEqual([
      { amountFen: 1000, amountDisplay: '¥10', quotaCount: 333 },
      { amountFen: 5000, amountDisplay: '¥50', quotaCount: 1666 },
      { amountFen: 10000, amountDisplay: '¥100', quotaCount: 3333 },
    ]);
  });

  it('非法充值档位直接拒绝，不写库', async () => {
    await expect(service.recharge(42, 9999)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(delegates.storeMembershipProfile.upsert).not.toHaveBeenCalled();
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  it('充值到账：余额叠加并写充值流水', async () => {
    delegates.storeMembershipProfile.upsert.mockResolvedValue({ storeId: 42 });
    delegates.storeMembershipProfile.update.mockResolvedValue({
      newCustomerQuota: 333,
    });
    mockOverviewRead(333, 0);

    await expect(service.recharge(42, 1000)).resolves.toMatchObject({
      remaining: 333,
    });

    expect(delegates.storeMembershipProfile.update).toHaveBeenCalledWith({
      where: { storeId: 42 },
      data: { newCustomerQuota: { increment: 333 } },
      select: { newCustomerQuota: true },
    });
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: 42,
          type: 'recharge',
          changeAmount: 333,
          balanceAfter: 333,
          amountFen: 1000,
        }),
      }),
    );
  });

  it('会员赠送：月度 +50，永久同年度 +300', async () => {
    delegates.storeMembershipProfile.upsert.mockResolvedValue({ storeId: 42 });
    delegates.storeMembershipProfile.update.mockResolvedValue({
      newCustomerQuota: 50,
    });

    await expect(service.grantByPlan(42, 'monthly')).resolves.toBe(50);
    await expect(service.grantByPlan(42, 'lifetime')).resolves.toBe(300);
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledTimes(2);
  });

  it('免费会员不赠送额度，也不写流水', async () => {
    await expect(service.grantByPlan(42, 'free')).resolves.toBe(0);
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
    await expect(service.grantByPlan(42, undefined)).resolves.toBe(0);
  });

  it('清零：有余额时写清零流水，余额为 0 时不写', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 50,
    });
    await service.clear(42, '设置为免费会员，新用户额度清零');
    expect(delegates.storeMembershipProfile.update).toHaveBeenCalledWith({
      where: { storeId: 42 },
      data: { newCustomerQuota: 0 },
    });
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'clear',
          changeAmount: -50,
          balanceAfter: 0,
        }),
      }),
    );

    delegates.storeNewCustomerQuotaLog.create.mockClear();
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
    });
    await service.clear(42, '注销账号，新用户额度清零');
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  it('新客扣减：余额充足时扣 1 并写消耗流水', async () => {
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 1 });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 85,
    });

    await expect(
      service.consumeForNewCustomer(42, '13800000000'),
    ).resolves.toEqual({
      consumed: true,
      remaining: 85,
    });
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'consume',
          changeAmount: -1,
          balanceAfter: 85,
        }),
      }),
    );
  });

  it('同一手机号重复绑定不重复扣减（幂等）', async () => {
    delegates.storeNewCustomerQuotaConsume.create.mockRejectedValueOnce(
      buildUniqueConstraintError(),
    );
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 85,
    });

    await expect(
      service.consumeForNewCustomer(42, '13800000000'),
    ).resolves.toEqual({
      consumed: false,
      remaining: 85,
    });
    expect(delegates.storeMembershipProfile.updateMany).not.toHaveBeenCalled();
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  it('额度耗尽时抛业务码 NEW_CUSTOMER_QUOTA_EXHAUSTED，且不写消耗流水', async () => {
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.consumeForNewCustomer(42, '13800000000'),
    ).rejects.toMatchObject({
      response: {
        message: NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
        code: NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
      },
    });
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  it('并发扣减不会超卖：条件更新命中 0 行即视为额度不足', async () => {
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.consumeForNewCustomer(42, '13800000000'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delegates.storeMembershipProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 42, newCustomerQuota: { gt: 0 } },
      }),
    );
  });

  it('新客判定：本店无该手机号档案即为新客', async () => {
    delegates.marketingCustomer.findFirst.mockResolvedValueOnce(null);
    await expect(service.isNewCustomer(42, '13800000000')).resolves.toBe(true);

    delegates.marketingCustomer.findFirst.mockResolvedValueOnce({ id: 9 });
    await expect(service.isNewCustomer(42, '13800000000')).resolves.toBe(false);
  });

  it('预检：余额大于 0 才允许绑定', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValueOnce({
      newCustomerQuota: 0,
    });
    await expect(service.hasRemaining(42)).resolves.toBe(false);

    delegates.storeMembershipProfile.findUnique.mockResolvedValueOnce({
      newCustomerQuota: 1,
    });
    await expect(service.hasRemaining(42)).resolves.toBe(true);
  });
});
