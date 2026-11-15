// 购卡余额结算：扣款、流水与顾客指标必须同口径，余额不足绝不扣款
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { settleCardBalancePayment } from './club-card-balance-settlement.helper';

// 会员等级阈值查询依赖真实表结构，结算单测只关心「读阈值后回写等级」这一协作关系
jest.mock('../../purely-profit/marketing/marketing.query', () => ({
  queryCustomerTierThresholds: jest
    .fn()
    .mockResolvedValue({ gold: 100000, diamond: 500000 }),
}));

const ORDER = {
  id: 11,
  orderNo: 'MC202611020001',
  storeId: 2,
  amount: 19900,
  planNameSnapshot: '年享卡',
};

interface TxStub {
  $queryRaw: jest.Mock;
  marketingCustomer: {
    findFirst: jest.Mock;
    updateMany: jest.Mock;
  };
  marketingConsumption: { create: jest.Mock };
}

/**
 * 构造事务桩：默认余额充足、条件更新命中。
 * `$queryRaw` 返回一行 = UPDATE ... RETURNING 命中；返回空数组 = 并发条件未命中。
 */
const buildTx = (options?: {
  balance?: number;
  updateCount?: number;
}): TxStub => ({
  $queryRaw: jest.fn().mockResolvedValue(
    options?.updateCount === 0
      ? []
      : [
          {
            total_spent: 29900,
            visit_count: 1,
            balance: (options?.balance ?? 50000) - ORDER.amount,
            tier: 'regular',
          },
        ],
  ),
  marketingCustomer: {
    findFirst: jest.fn().mockResolvedValue({
      id: 7,
      totalSpent: 10000,
      balance: options?.balance ?? 50000,
    }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  marketingConsumption: { create: jest.fn().mockResolvedValue({ id: 1 }) },
});

const asTx = (tx: TxStub): Prisma.TransactionClient =>
  tx as unknown as Prisma.TransactionClient;

describe('settleCardBalancePayment 余额扣款', () => {
  it('余额充足时扣款、记流水并同步累计消费', async () => {
    const tx = buildTx({ balance: 50000 });

    await settleCardBalancePayment(asTx(tx), ORDER, 7);

    expect(tx.marketingConsumption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: ORDER.storeId,
        customerId: 7,
        amount: ORDER.amount,
        balancePaid: ORDER.amount,
        pointsDeducted: 0,
        actualPointsDeducted: 0,
        payType: 'balance',
        itemsSummary: '年享卡 · 会员卡购买',
      }),
    });
    // 扣款 + 累计消费 + 到店次数在一次条件 UPDATE 内原子完成
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const values = tx.$queryRaw.mock.calls[0].slice(1) as unknown[];
    expect(values).toContain(-ORDER.amount);
    expect(values).toContain(ORDER.amount);
  });

  it('余额不足时直接拒绝且不写流水、不扣款', async () => {
    const tx = buildTx({ balance: 100 });

    await expect(
      settleCardBalancePayment(asTx(tx), ORDER, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.marketingConsumption.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('并发扣款失败（条件更新未命中）时抛业务异常', async () => {
    const tx = buildTx({ balance: 50000, updateCount: 0 });

    await expect(
      settleCardBalancePayment(asTx(tx), ORDER, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('顾客档案缺失时拒绝结算', async () => {
    const tx = buildTx();
    tx.marketingCustomer.findFirst.mockResolvedValue(null);

    await expect(
      settleCardBalancePayment(asTx(tx), ORDER, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.marketingConsumption.create).not.toHaveBeenCalled();
  });
});
