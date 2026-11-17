// 扫码点餐落账：积分 / 指标合并成同一条 UPDATE 后的数值一致性
import type { Prisma } from '@prisma/client';
import { ClubScanOrderingMarketingCustomerService } from './club-scan-ordering-marketing-customer.service';
import type { ScanOrderPointsSettlementInput } from './club-scan-ordering-marketing-customer.service';

const STORE_ID = 11;
const CUSTOMER_ID = 9001;
/** earnRatioCents = 1 → 每 1 元（100 分）得 1 积分；字段必须完整，否则解析回落默认值 */
const POINTS_RATIO = {
  enabled: true,
  earnRatioCents: 1,
  earnRatioYuan: 1,
  redeemRatioPoints: 1,
  maxRedeemRatio: 0.1,
  maxRedeemPct: 10,
  updatedAt: 0,
};

interface CapturedRow {
  total_spent: number;
  visit_count: number;
  balance: number;
  points: number;
  tier: 'regular' | 'gold' | 'diamond';
}

const buildTx = (
  options: {
    row?: CapturedRow | null;
    /** 生效的 points_2x 活动 */
    doublePoints?: boolean;
    pointsEnabled?: boolean;
  } = {},
) => {
  const queryRaw = jest.fn().mockResolvedValue(
    options.row === null
      ? []
      : [
          // total_spent = 0 → 重算等级仍是 regular，避免触发跨档的二次写入
          options.row ?? {
            total_spent: 0,
            visit_count: 0,
            balance: 5000,
            points: 88,
            tier: 'regular',
          },
        ],
  );
  const createMany = jest.fn().mockResolvedValue({ count: 2 });
  const consumptionCreate = jest.fn().mockResolvedValue({});
  const tx = {
    $queryRaw: queryRaw,
    marketingMemberLevelSetting: {
      findUnique: jest.fn().mockResolvedValue({
        pointsRatio: {
          ...POINTS_RATIO,
          enabled: options.pointsEnabled ?? true,
        },
        levels: null,
      }),
    },
    marketingPromotion: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options.doublePoints === true ? { id: 3 } : null),
    },
    marketingCustomer: { updateMany: jest.fn() },
    marketingPointsRecord: { createMany, create: jest.fn() },
    marketingConsumption: { create: consumptionCreate },
  };
  return { tx, queryRaw, createMany, consumptionCreate };
};

const baseInput: ScanOrderPointsSettlementInput = {
  storeId: STORE_ID,
  orderId: 1001,
  orderNo: 'SO20261116000001',
  customerId: CUSTOMER_ID,
  paidAmountFen: 5000,
  pointsUsed: 120,
  pointsDeductAmount: 1200,
  payType: 'wechat',
};

/** 取原生 UPDATE 的参数（模板插值） */
const sqlParams = (queryRaw: jest.Mock): unknown[] =>
  queryRaw.mock.calls[0]!.slice(1);

/** 取拼进 SQL 的 Prisma.sql 片段（条件分支），用于断言其中的参数 */
const sqlFragments = (queryRaw: jest.Mock): Array<{ values: unknown[] }> =>
  sqlParams(queryRaw).filter(
    (value): value is { values: unknown[] } =>
      typeof value === 'object' && value !== null && 'values' in value,
  );

describe('ClubScanOrderingMarketingCustomerService 落账数值一致性', () => {
  const service = new ClubScanOrderingMarketingCustomerService({} as never);

  it('积分增量 = 赠送 − 抵扣，指标与原实现逐字段一致', async () => {
    const { tx, queryRaw, consumptionCreate } = buildTx();

    const result = await service.settlePaidOrder(
      tx as unknown as Prisma.TransactionClient,
      baseInput,
    );

    // 赠送积分 = floor(5000 分 / (1 × 100)) = 50
    expect(result.earnedPoints).toBe(50);
    // 唯一一次 customer 行写入（不再有 deduct / award / metrics 三次）
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.marketingCustomer.updateMany).not.toHaveBeenCalled();

    // 积分增量 = 50 - 120 = -70；累计消费 = 6200；次数 +1
    expect(sqlParams(queryRaw)).toEqual(
      expect.arrayContaining([0, -70, 6200, 1, true, CUSTOMER_ID, STORE_ID]),
    );
    // 抵扣防线：`points >= 120` 与增量写在同一条 UPDATE 里
    expect(sqlFragments(queryRaw).flatMap((item) => item.values)).toContain(
      120,
    );

    // 消费流水金额 = 实付 5000 + 抵扣 1200
    expect(consumptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 6200,
        balancePaid: 0,
        pointsDeducted: 1200,
        actualPointsDeducted: 120,
        payType: 'wechat',
      }),
    });
  });

  it('两条积分流水合并成一次 createMany（spend + earn）', async () => {
    const { tx, createMany } = buildTx();

    await service.settlePaidOrder(
      tx as unknown as Prisma.TransactionClient,
      baseInput,
    );

    expect(tx.marketingPointsRecord.create).not.toHaveBeenCalled();
    expect(createMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0]![0].data as Array<{
      amount: number;
      type: string;
    }>;
    expect(data).toEqual([
      expect.objectContaining({ amount: -120, type: 'spend' }),
      expect.objectContaining({ amount: 50, type: 'earn' }),
    ]);
  });

  it('未使用积分时不加 points 下限条件，指标仍按实付金额累加', async () => {
    const { tx, queryRaw } = buildTx();

    await service.settlePaidOrder(tx as unknown as Prisma.TransactionClient, {
      ...baseInput,
      pointsUsed: 0,
      pointsDeductAmount: 0,
    });

    const sql = (queryRaw.mock.calls[0]![0] as unknown as string[]).join(' ');
    expect(sql).not.toContain('AND points >=');
    // total_spent 增量 = 5000，visit_count 增量 = 1
    expect(sqlParams(queryRaw)).toEqual(
      expect.arrayContaining([0, 50, 5000, 1, true, CUSTOMER_ID, STORE_ID]),
    );
  });

  it('积分规则未启用时不赠送积分，只扣抵扣积分', async () => {
    const { tx, queryRaw } = buildTx({ pointsEnabled: false });

    const result = await service.settlePaidOrder(
      tx as unknown as Prisma.TransactionClient,
      baseInput,
    );

    expect(result.earnedPoints).toBe(0);
    expect(sqlParams(queryRaw)).toEqual(expect.arrayContaining([-120]));
  });

  it('双倍积分活动生效时赠送翻倍', async () => {
    const { tx } = buildTx({ doublePoints: true });

    const result = await service.settlePaidOrder(
      tx as unknown as Prisma.TransactionClient,
      baseInput,
    );

    expect(result.earnedPoints).toBe(100);
  });

  it('抵扣积分不足（条件未命中）时抛原错误，且不写流水', async () => {
    const { tx, createMany, consumptionCreate } = buildTx({ row: null });

    await expect(
      service.settlePaidOrder(
        tx as unknown as Prisma.TransactionClient,
        baseInput,
      ),
    ).rejects.toThrow('积分不足或已被并发抵扣，当前积分无法完成扣减');
    expect(createMany).not.toHaveBeenCalled();
    expect(consumptionCreate).not.toHaveBeenCalled();
  });

  it('未用积分且档案行不存在时静默跳过指标（与改造前一致）', async () => {
    const { tx, consumptionCreate } = buildTx({ row: null });

    await service.settlePaidOrder(tx as unknown as Prisma.TransactionClient, {
      ...baseInput,
      pointsUsed: 0,
      pointsDeductAmount: 0,
    });

    // 流水仍照常写入（这是既有行为）
    expect(consumptionCreate).toHaveBeenCalledTimes(1);
  });
});
