import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { debitCustomerBalance } from '../payments/club-balance-settlement.utils';
import { awardPointsForSettlement } from './club-order-settlement-points.utils';
import { ClubOrderSettlementService } from './club-order-settlement.service';
import type { CacheInvalidatorService } from '../../redis/invalidator';
import type { ClubOrderDraftsService } from './club-order-drafts.service';
import type { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import type { ClubOrderDraftPayload } from './club-order-drafts.types';
import type { ClubServiceOrderMetadata } from './club-order-drafts.types';

interface SettlementRulesSnapshot {
  tierThresholds: { gold: number; diamond: number };
  points: {
    pointsEarnConfig: { earnRatioCents: number; enabled: boolean };
    pointsMultiplier: number;
  };
}

const buildTx = () => ({
  // 原子指标内核走 UPDATE ... RETURNING，返回一行即模拟条件更新命中
  $queryRaw: jest
    .fn()
    .mockResolvedValue([
      { total_spent: 100, visit_count: 1, balance: 900, tier: 'regular' },
    ]),
  marketingMemberLevelSetting: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
  marketingPromotion: { findFirst: jest.fn().mockResolvedValue(null) },
  marketingCustomer: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
  },
  marketingPointsRecord: { create: jest.fn().mockResolvedValue({}) },
});

type Tx = ReturnType<typeof buildTx>;
const asTx = (tx: Tx): Prisma.TransactionClient =>
  tx as unknown as Prisma.TransactionClient;

describe('结算规则预加载（事务内零配置查询）', () => {
  let tx: Tx;

  beforeEach(() => {
    tx = buildTx();
  });

  it('debitCustomerBalance 传入阈值时不再查门店等级配置', async () => {
    await debitCustomerBalance(asTx(tx), {
      customerId: 7,
      storeId: 11,
      balancePaidFen: 100,
      metrics: { settlementAmountFen: 100 },
      tierThresholds: { gold: 10_000, diamond: 50_000 },
    });

    expect(tx.marketingMemberLevelSetting.findUnique).not.toHaveBeenCalled();
    // 累计消费与到店次数作为同一条 UPDATE 的增量参数传入，不再拼 data.increment
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(
      expect.arrayContaining([100, 1]),
    );
  });

  it('debitCustomerBalance 未传阈值时保持事务内读取（向后兼容）', async () => {
    await debitCustomerBalance(asTx(tx), {
      customerId: 7,
      storeId: 11,
      balancePaidFen: 100,
      metrics: { settlementAmountFen: 100 },
    });

    expect(tx.marketingMemberLevelSetting.findUnique).toHaveBeenCalledTimes(1);
  });

  it('awardPointsForSettlement 传入积分规则时不再查配置与活动', async () => {
    const earned = await awardPointsForSettlement(
      asTx(tx),
      { storeId: 11, description: '服务订单', paidAmountFen: 20_000 },
      7,
      {
        pointsEarnConfig: { earnRatioCents: 1, enabled: true },
        pointsMultiplier: 2,
      },
    );

    expect(tx.marketingMemberLevelSetting.findUnique).not.toHaveBeenCalled();
    expect(tx.marketingPromotion.findFirst).not.toHaveBeenCalled();
    // 200 基础积分 × 双倍 = 400
    expect(earned).toBe(400);
    expect(tx.marketingCustomer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { points: { increment: 400 } },
      }),
    );
  });

  it('awardPointsForSettlement 未传规则时回落到事务内读取', async () => {
    await awardPointsForSettlement(
      asTx(tx),
      { storeId: 11, description: '服务订单', paidAmountFen: 20_000 },
      7,
    );

    expect(tx.marketingMemberLevelSetting.findUnique).toHaveBeenCalled();
  });
});

describe('ClubOrderSettlementService 事务外预加载', () => {
  it('三项规则通过非事务 Prisma 客户端加载并返回完整快照', async () => {
    const prisma = {
      marketingMemberLevelSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      marketingPromotion: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ClubOrderSettlementService(
      prisma as unknown as PrismaService,
      {} as ClubOrderDraftsService,
      {} as CacheInvalidatorService,
      {} as ClubPaymentLockService,
    );
    const draft = {
      storeId: 11,
    } as unknown as ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>;

    const rules = await (
      service as unknown as {
        preloadSettlementRules(
          d: typeof draft,
        ): Promise<SettlementRulesSnapshot>;
      }
    ).preloadSettlementRules(draft);

    expect(typeof rules.tierThresholds.gold).toBe('number');
    expect(typeof rules.tierThresholds.diamond).toBe('number');
    expect(typeof rules.points.pointsEarnConfig.earnRatioCents).toBe('number');
    expect(rules.points.pointsMultiplier).toBe(1);
    // 等级阈值 + 积分配置都读门店配置表，且不经过事务客户端
    expect(prisma.marketingMemberLevelSetting.findUnique).toHaveBeenCalledTimes(
      2,
    );
  });
});
