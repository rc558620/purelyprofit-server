import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { Money } from '../../../shared/money.utils';
import { type CheckoutMemberCardSnapshot } from './space-session-checkout-card.shared';
import {
  applyCheckoutAssets,
  deductCheckoutCustomerBalance,
  type CheckoutAssetsResolution,
} from './space-session-checkout-assets.shared';

const createTransactionClient = (patch: Record<string, unknown>) =>
  patch as unknown as Prisma.TransactionClient;

const createCardSnapshot = (
  patch: Partial<CheckoutMemberCardSnapshot>,
): CheckoutMemberCardSnapshot => ({
  cardId: 8,
  cardNo: 'CARD-8',
  kind: 'times',
  perUseTimes: 1,
  hasPendingReserve: false,
  ...patch,
});

describe('applyCheckoutAssets - 会员卡确认扣次', () => {
  it('开台已预扣时只把 reserve 置 done 并按流水次数补 usedTimes（幂等）', async () => {
    const updateManyAndReturn = jest
      .fn()
      .mockResolvedValueOnce([{ deltaTimes: -2 }])
      .mockResolvedValueOnce([]);
    const memberCardUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = createTransactionClient({
      memberCardTransaction: { updateManyAndReturn },
      memberCard: { updateMany: memberCardUpdateMany },
    });

    await applyCheckoutAssets(tx, {
      resolution: {
        cardDeductionMoney: Money.zero(),
        voucherDeductionMoney: Money.zero(),
        balanceDeductionMoney: Money.zero(),
        payableMoney: Money.zero(),
        card: createCardSnapshot({ hasPendingReserve: true, perUseTimes: 2 }),
        voucherCode: null,
        balanceAssetId: null,
        customerId: 9,
      } as CheckoutAssetsResolution,
      storeId: 3,
      sessionId: 21,
      saleOrderNo: 'SO-1',
      spaceNameSnapshot: 'A 台',
      operatorStaffId: 5,
    });

    expect(updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          relatedSessionId: 21,
          cardId: 8,
          changeType: 'reserve',
          status: 'pending',
        }),
        data: expect.objectContaining({ status: 'done' }),
      }),
    );
    expect(memberCardUpdateMany).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { usedTimes: { increment: 2 } },
    });

    // 第二次确认：pending 已不存在 → 不再递增 usedTimes，不重复扣次
    await applyCheckoutAssets(tx, {
      resolution: {
        cardDeductionMoney: Money.zero(),
        voucherDeductionMoney: Money.zero(),
        balanceDeductionMoney: Money.zero(),
        payableMoney: Money.zero(),
        card: createCardSnapshot({ hasPendingReserve: true, perUseTimes: 2 }),
        voucherCode: null,
        balanceAssetId: null,
        customerId: 9,
      } as CheckoutAssetsResolution,
      storeId: 3,
      sessionId: 21,
      saleOrderNo: 'SO-1',
      spaceNameSnapshot: 'A 台',
    });
    expect(memberCardUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('结账当场选次数卡时按 remainTimes >= n 条件扣次并写 consume 流水', async () => {
    const cardUpdateManyAndReturn = jest
      .fn()
      .mockResolvedValue([{ remainTimes: 3 }]);
    const transactionCreate = jest.fn().mockResolvedValue({ id: 1 });
    const tx = createTransactionClient({
      memberCard: { updateManyAndReturn: cardUpdateManyAndReturn },
      memberCardTransaction: { create: transactionCreate },
    });

    await applyCheckoutAssets(tx, {
      resolution: {
        cardDeductionMoney: Money.zero(),
        voucherDeductionMoney: Money.zero(),
        balanceDeductionMoney: Money.zero(),
        payableMoney: Money.zero(),
        card: createCardSnapshot({}),
        voucherCode: null,
        balanceAssetId: null,
        customerId: 9,
      } as CheckoutAssetsResolution,
      storeId: 3,
      sessionId: 21,
      saleOrderNo: 'SO-1',
      spaceNameSnapshot: 'A 台',
    });

    expect(cardUpdateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 8,
          storeId: 3,
          status: 'active',
          remainTimes: { gte: 1 },
        }),
      }),
    );
    expect(transactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changeType: 'consume',
          status: 'done',
          deltaTimes: -1,
          beforeTimes: 4,
          afterTimes: 3,
          relatedSaleOrderNo: 'SO-1',
        }),
      }),
    );
  });

  it('条件扣次命中 0 行（并发已扣完）时抛冲突', async () => {
    const tx = createTransactionClient({
      memberCard: { updateManyAndReturn: jest.fn().mockResolvedValue([]) },
      memberCardTransaction: { create: jest.fn() },
    });

    await expect(
      applyCheckoutAssets(tx, {
        resolution: {
          cardDeductionMoney: Money.zero(),
          voucherDeductionMoney: Money.zero(),
          balanceDeductionMoney: Money.zero(),
          payableMoney: Money.zero(),
          card: createCardSnapshot({}),
          voucherCode: null,
          balanceAssetId: null,
          customerId: 9,
        } as CheckoutAssetsResolution,
        storeId: 3,
        sessionId: 21,
        saleOrderNo: 'SO-1',
        spaceNameSnapshot: 'A 台',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('deductCheckoutCustomerBalance', () => {
  it('按 balance >= 扣减额 条件更新，命中 0 行时抛冲突（防超扣）', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const tx = createTransactionClient({ marketingCustomer: { updateMany } });

    await expect(
      deductCheckoutCustomerBalance(tx, {
        storeId: 3,
        customerId: 9,
        assetId: '9',
        amountMoney: Money.fromInputYuan(30),
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 9,
        storeId: 3,
        deletedAt: null,
        balance: { gte: 3000 },
      },
      data: { balance: { decrement: 3000 } },
    });
  });

  it('余额归属与会话会员不一致时拒绝', async () => {
    const tx = createTransactionClient({ marketingCustomer: {} });

    await expect(
      deductCheckoutCustomerBalance(tx, {
        storeId: 3,
        customerId: 9,
        assetId: '10',
        amountMoney: Money.fromInputYuan(1),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('未识别会员时拒绝余额抵扣', async () => {
    const tx = createTransactionClient({ marketingCustomer: {} });

    await expect(
      deductCheckoutCustomerBalance(tx, {
        storeId: 3,
        customerId: null,
        assetId: null,
        amountMoney: Money.fromInputYuan(1),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('applyCheckoutAssets - 券核销', () => {
  it('券抵扣金额超过券面金额时拒绝', async () => {
    const tx = createTransactionClient({
      clubVoucherOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          storeId: 3,
          status: 'pending',
          usedSessionId: null,
          paidAmountFen: 1000,
          customerId: null,
          voucherCode: 'VC-1',
        }),
        updateMany: jest.fn(),
      },
    });

    await expect(
      applyCheckoutAssets(tx, {
        resolution: {
          cardDeductionMoney: Money.zero(),
          voucherDeductionMoney: Money.fromInputYuan(20),
          balanceDeductionMoney: Money.zero(),
          payableMoney: Money.zero(),
          card: null,
          voucherCode: 'VC-1',
          balanceAssetId: null,
          customerId: null,
        } as CheckoutAssetsResolution,
        storeId: 3,
        sessionId: 21,
        saleOrderNo: 'SO-1',
        spaceNameSnapshot: 'A 台',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
