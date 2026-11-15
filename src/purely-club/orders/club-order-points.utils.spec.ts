import type { PrismaService } from '../../prisma/prisma.service';
import {
  resolvePointsDeduction,
  resolvePointsDeductionFromAvailablePoints,
} from './club-order-points.utils';

/**
 * 3-B-5：积分抵扣拆成「查顾客行」与「用已读积分计算」两个入口后，
 * 必须保证两者结果一致、且早退语义（不查库）不漂移。
 */
describe('club-order-points.utils 积分抵扣入口', () => {
  const storeId = 11;
  const customerId = 36;

  const POINTS_RATIO = {
    earnRatioCents: 100,
    redeemRatioPoints: 100,
    maxRedeemRatio: 0.5,
    enabled: true,
    updatedAt: 0,
  };

  const buildPrisma = (
    customer: { points: number } | null = { points: 5_000 },
  ): {
    prisma: PrismaService;
    customerFindUnique: jest.Mock;
    settingFindUnique: jest.Mock;
  } => {
    const customerFindUnique = jest.fn().mockResolvedValue(customer);
    const settingFindUnique = jest
      .fn()
      .mockResolvedValue({ pointsRatio: POINTS_RATIO });
    const prisma = {
      marketingCustomer: { findUnique: customerFindUnique },
      marketingMemberLevelSetting: { findUnique: settingFindUnique },
      marketingPromotion: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    return { prisma, customerFindUnique, settingFindUnique };
  };

  it('未开启积分抵扣时两个入口都不查库', async () => {
    const { prisma, customerFindUnique, settingFindUnique } = buildPrisma();

    await expect(
      resolvePointsDeduction(prisma, storeId, customerId, 10_000, false),
    ).resolves.toEqual({ pointsDeductFen: 0, pointsUsed: 0 });
    await expect(
      resolvePointsDeductionFromAvailablePoints(prisma, {
        storeId,
        priceAfterDiscountFen: 10_000,
        usePoints: false,
        availablePoints: 5_000,
      }),
    ).resolves.toEqual({ pointsDeductFen: 0, pointsUsed: 0 });

    expect(customerFindUnique).not.toHaveBeenCalled();
    expect(settingFindUnique).not.toHaveBeenCalled();
  });

  it('折后价不大于 0 时两个入口都不查库', async () => {
    const { prisma, customerFindUnique, settingFindUnique } = buildPrisma();

    await expect(
      resolvePointsDeduction(prisma, storeId, customerId, 0, true),
    ).resolves.toEqual({ pointsDeductFen: 0, pointsUsed: 0 });
    await expect(
      resolvePointsDeductionFromAvailablePoints(prisma, {
        storeId,
        priceAfterDiscountFen: 0,
        usePoints: true,
        availablePoints: 5_000,
      }),
    ).resolves.toEqual({ pointsDeductFen: 0, pointsUsed: 0 });

    expect(customerFindUnique).not.toHaveBeenCalled();
    expect(settingFindUnique).not.toHaveBeenCalled();
  });

  it('同一份顾客积分下两个入口结果完全一致', async () => {
    const { prisma } = buildPrisma({ points: 5_000 });

    const fromCustomerId = await resolvePointsDeduction(
      prisma,
      storeId,
      customerId,
      10_000,
      true,
    );
    const fromAvailablePoints = await resolvePointsDeductionFromAvailablePoints(
      prisma,
      {
        storeId,
        priceAfterDiscountFen: 10_000,
        usePoints: true,
        availablePoints: 5_000,
      },
    );

    expect(fromCustomerId).toEqual(fromAvailablePoints);
    // 折后 ¥100、最大抵扣 50%、5000 积分 / 100 = ¥50 → 封顶 ¥50
    expect(fromCustomerId).toEqual({
      pointsDeductFen: 5_000,
      pointsUsed: 5_000,
    });
  });

  it('顾客行不存在时按 0 积分处理（与历史入口一致）', async () => {
    const { prisma } = buildPrisma(null);

    const fromCustomerId = await resolvePointsDeduction(
      prisma,
      storeId,
      customerId,
      10_000,
      true,
    );
    const fromAvailablePoints = await resolvePointsDeductionFromAvailablePoints(
      prisma,
      {
        storeId,
        priceAfterDiscountFen: 10_000,
        usePoints: true,
        availablePoints: 0,
      },
    );

    expect(fromCustomerId).toEqual({ pointsDeductFen: 0, pointsUsed: 0 });
    expect(fromAvailablePoints).toEqual(fromCustomerId);
  });
});
