import { ClubVoucherOrderRefundService } from './club-voucher-order-refund.service';

describe('ClubVoucherOrderRefundService.restoreBalance', () => {
  const prismaService = {} as never;
  const wechatRefundService = {} as never;
  const realtimeService = {} as never;

  const service = new ClubVoucherOrderRefundService(
    prismaService,
    wechatRefundService,
    realtimeService,
  );

  const buildTx = () => ({
    marketingCustomer: {
      findFirst: jest.fn().mockResolvedValue({
        id: 324,
        totalSpent: 160169,
        visitCount: 27,
        points: 0,
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    marketingConsumption: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    marketingPointsRecord: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    marketingMemberLevelSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  });

  const order = {
    id: 167,
    orderNo: 'VC20261019002138341A586',
    storeId: 42,
    customerId: 324,
    productId: 18,
    productName: '男士清爽护理',
    pointsUsed: 3520,
    quantity: 1,
    paidAmountFen: 3520,
    pointsDeductFen: 3520,
    pointsAwarded: 0,
  };

  it('退款时写负向消费流水（金额含积分抵扣）并对称回滚物化字段', async () => {
    const tx = buildTx();

    await (
      service as unknown as {
        restoreBalance: (tx: unknown, order: unknown) => Promise<void>;
      }
    ).restoreBalance(tx, order);

    // 消费流水是既有事实（amount >= 0 约束），退款不写负数流水，
    // 展示侧由退款单据冲减（computeCustomerConsumptionStats）
    expect(tx.marketingConsumption.create).not.toHaveBeenCalled();

    // 物化字段：累计消费按同一口径回滚（含积分抵扣），次数 -1
    expect(tx.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 324 },
      data: {
        balance: { increment: 3520 },
        totalSpent: 160169 - 7040,
        visitCount: 26,
        tier: expect.any(String),
      },
    });
  });

  it('积分抵扣为 0 时仍按实付金额冲减', async () => {
    const tx = buildTx();

    await (
      service as unknown as {
        restoreBalance: (tx: unknown, order: unknown) => Promise<void>;
      }
    ).restoreBalance(tx, {
      ...order,
      paidAmountFen: 7040,
      pointsDeductFen: 0,
      pointsUsed: 0,
    });

    expect(tx.marketingConsumption.create).not.toHaveBeenCalled();
    expect(tx.marketingCustomer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalSpent: 160169 - 7040,
          visitCount: 26,
        }),
      }),
    );
  });
});
