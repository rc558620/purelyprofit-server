// 余额回补口径的回归用例：账目字段必须与结算时同口径反向冲减
// 回补逻辑已抽到 club-voucher-order-refund-restore.helper.ts（与商家拒绝链路共用）
import { restoreVoucherBalance } from './club-voucher-order-refund-restore.helper';

describe('ClubVoucherOrderRefundService.restoreBalance', () => {
  /**
   * 事务桩：`$queryRaw` 返回一行 = 原子回滚命中。
   * 返回的 total_spent 与 tier 保持自洽，避免跨档触发额外的 tier 写回。
   */
  const buildTx = () => ({
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { total_spent: 0, visit_count: 0, balance: 0, tier: 'regular' },
      ]),
    marketingCustomer: {
      findFirst: jest.fn().mockResolvedValue({
        id: 324,
        points: 0,
      }),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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

  const deltasOf = (tx: ReturnType<typeof buildTx>): unknown[] =>
    tx.$queryRaw.mock.calls[0].slice(1) as unknown[];

  it('退款时按实付 + 积分抵扣同口径原子回滚，且不写负向消费流水', async () => {
    const tx = buildTx();

    await restoreVoucherBalance(
      tx as unknown as Parameters<typeof restoreVoucherBalance>[0],
      order,
    );

    // 消费流水是既有事实（amount >= 0 约束），退款不写负数流水，
    // 展示侧由退款单据冲减（computeCustomerConsumptionStats）
    expect(tx.marketingConsumption.create).not.toHaveBeenCalled();

    // 余额退回 3520、积分增量 0、累计消费回滚 -(3520+3520)、到店次数 -1，四个增量一次原子写
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(deltasOf(tx).slice(0, 4)).toEqual([3520, 0, -7040, -1]);
    // 回滚改走增量语义，不再用读到的旧值做绝对赋值
    expect(tx.marketingCustomer.update).not.toHaveBeenCalled();
  });

  it('积分抵扣为 0 时仍按实付金额冲减', async () => {
    const tx = buildTx();

    await restoreVoucherBalance(
      tx as unknown as Parameters<typeof restoreVoucherBalance>[0],
      {
        ...order,
        paidAmountFen: 7040,
        pointsDeductFen: 0,
        pointsUsed: 0,
      },
    );

    expect(tx.marketingConsumption.create).not.toHaveBeenCalled();
    expect(deltasOf(tx).slice(0, 4)).toEqual([7040, 0, -7040, -1]);
  });
});
