/**
 * 余额快照「DB 窗口聚合」vs「内存全量反推」真实库对照。
 *
 * 为什么必须连真实库：余额快照的等价性依赖 PostgreSQL 的三个事实——
 *   1. 窗口函数 `SUM(...) OVER (ORDER BY ... ROWS UNBOUNDED PRECEDING)` 的累加语义；
 *   2. 同一事务写入的多行 `created_at` 完全相同，只能靠 kind 权重 + 主键定序；
 *   3. `CASE` 复刻的 effect 口径（充值含赠送 / 赠送脏数据回退 / 退款整笔扣回）与
 *      Prisma 读取的行值一致。
 * 单测只能证明「数学公式相等」，证明不了 SQL 与 JS 对同一批行给出同一串快照。
 *
 * 造数策略：新建一个探针顾客，把它名下的流水当作「全部历史」（窗口即全量），
 * 余额/积分设成流水净值，于是正确的快照 = 升序累计值，可与手工期望值逐条硬断言，
 * 而不是只做两条链路互证（互证无法发现两边一起错的口径漂移）。
 *
 * 运行：node --experimental-vm-modules node_modules/jest/bin/jest.js \
 *        --config ./test/jest-e2e.json --runInBand club-ledger-balance-snapshot-real-db
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import configuration from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import { ClubRecordQueryService } from '../src/purely-club/records/club-record-query.service';
import { ClubPointsQueryService } from '../src/purely-club/points/club-points-query.service';
import type { ClubLedgerEntry } from '../src/purely-club/records/club-records.types';
import {
  buildLedgerBalanceSnapshotsFromEntries,
  buildLedgerBalanceSnapshotsFromWindow,
  compareLedgerEntriesAsc,
} from '../src/purely-club/records/club-record-ledger-order.util';
import {
  buildPointsSnapshotsFromRecords,
  buildPointsSnapshotsFromWindow,
} from '../src/purely-club/points/club-points-snapshot.util';

const PROBE_TAG = `clubsnapshot${Date.now()}`;
const T1 = new Date('2026-01-10T10:00:00.000Z');
const T2 = new Date('2026-01-20T10:00:00.000Z');
const T3 = new Date('2026-02-01T10:00:00.000Z');

/** 手工期望值（分）：升序累计 = 快照（探针顾客名下无其它历史，起点为 0） */
const EXPECTED_LEDGER_SNAPSHOT = {
  bonus: 5000,
  recharge1: 125000,
  consume1: 95000,
  recharge2: 105000,
  refund: 85000,
} as const;
const EXPECTED_FINAL_BALANCE = 85000;

/** 积分期望值：净值 75，升序累计即快照 */
const EXPECTED_POINTS_SNAPSHOT = { p1: 100, p2: 70, p3: 80, p4: 75 } as const;

describe('余额快照真实库对照（窗口聚合 vs 内存反推）', () => {
  let prisma: PrismaService;
  let moduleRef: TestingModule;
  let recordQueryService: ClubRecordQueryService;
  let pointsQueryService: ClubPointsQueryService;
  let storeId: number | null = null;
  let customerId: number | null = null;
  const rechargeIds: number[] = [];
  const consumptionIds: number[] = [];
  const pointsIds: number[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      ],
    }).compile();
    const configService = moduleRef.get(ConfigService);
    prisma = new PrismaService(configService);
    await prisma.$connect();

    recordQueryService = new ClubRecordQueryService(prisma);
    pointsQueryService = new ClubPointsQueryService(prisma);

    const store = await prisma.store.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    storeId = store?.id ?? null;
    if (storeId === null) {
      return;
    }

    await seedLedger(storeId);
    await seedPoints(storeId);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.marketingRecharge.deleteMany({
        where: { id: { in: rechargeIds } },
      });
      await prisma.marketingConsumption.deleteMany({
        where: { id: { in: consumptionIds } },
      });
      await prisma.marketingPointsRecord.deleteMany({
        where: { id: { in: pointsIds } },
      });
      if (customerId !== null) {
        await prisma.marketingCustomer.deleteMany({
          where: { id: customerId },
        });
      }
      await prisma.$disconnect();
    }
    await moduleRef?.close();
  }, 60_000);

  /** 充值与消费：覆盖充值含赠送、赠送脏数据剔除、退款、balancePaid=0 剔除、同刻多条 */
  async function seedLedger(targetStoreId: number): Promise<void> {
    const customer = await prisma.marketingCustomer.create({
      data: {
        storeId: targetStoreId,
        name: `${PROBE_TAG}余额`,
        balance: EXPECTED_FINAL_BALANCE,
        points: EXPECTED_POINTS_SNAPSHOT.p4,
      },
      select: { id: true },
    });
    customerId = customer.id;

    const recharge = await prisma.marketingRecharge.create({
      data: {
        storeId: targetStoreId,
        customerId: customer.id,
        amount: 100000,
        giftAmount: 20000,
        totalAmount: 120000,
        type: 'recharge',
        note: PROBE_TAG,
        createdAt: T1,
      },
      select: { id: true },
    });
    const bonus = await prisma.marketingRecharge.create({
      data: {
        storeId: targetStoreId,
        customerId: customer.id,
        amount: 0,
        giftAmount: 5000,
        totalAmount: 5000,
        type: 'gift',
        note: PROBE_TAG,
        createdAt: T1,
      },
      select: { id: true },
    });
    const recharge2 = await prisma.marketingRecharge.create({
      data: {
        storeId: targetStoreId,
        customerId: customer.id,
        amount: 10000,
        giftAmount: 0,
        totalAmount: 10000,
        type: 'recharge',
        note: PROBE_TAG,
        createdAt: T2,
      },
      select: { id: true },
    });
    // 脏数据：gift 且金额为 0，必须整行剔除（不进流水、不进快照窗口）
    const bonusZero = await prisma.marketingRecharge.create({
      data: {
        storeId: targetStoreId,
        customerId: customer.id,
        amount: 0,
        giftAmount: 0,
        totalAmount: 0,
        type: 'gift',
        note: PROBE_TAG,
        createdAt: T2,
      },
      select: { id: true },
    });
    const refund = await prisma.marketingRecharge.create({
      data: {
        storeId: targetStoreId,
        customerId: customer.id,
        amount: 20000,
        giftAmount: 0,
        totalAmount: 20000,
        type: 'refund',
        note: PROBE_TAG,
        createdAt: T3,
      },
      select: { id: true },
    });

    const consume = await prisma.marketingConsumption.create({
      data: {
        storeId: targetStoreId,
        customerId: customer.id,
        amount: 30000,
        balancePaid: 30000,
        itemsSummary: PROBE_TAG,
        createdAt: T2,
      },
      select: { id: true },
    });
    // 现金消费：balancePaid = 0，不改变储值余额
    const consumeCash = await prisma.marketingConsumption.create({
      data: {
        storeId: targetStoreId,
        customerId: customer.id,
        amount: 8800,
        balancePaid: 0,
        itemsSummary: PROBE_TAG,
        createdAt: T1,
      },
      select: { id: true },
    });

    rechargeIds.push(
      recharge.id,
      bonus.id,
      recharge2.id,
      bonusZero.id,
      refund.id,
    );
    consumptionIds.push(consume.id, consumeCash.id);
  }

  async function seedPoints(targetStoreId: number): Promise<void> {
    if (customerId === null) {
      return;
    }
    const seeds: Array<{
      amount: number;
      type: 'earn' | 'spend' | 'gift' | 'expire';
      createdAt: Date;
    }> = [
      { amount: 100, type: 'earn', createdAt: T1 },
      { amount: -30, type: 'spend', createdAt: T2 },
      { amount: 10, type: 'gift', createdAt: T2 },
      { amount: -5, type: 'expire', createdAt: T3 },
    ];

    for (const seed of seeds) {
      const created = await prisma.marketingPointsRecord.create({
        data: {
          storeId: targetStoreId,
          customerId,
          amount: seed.amount,
          type: seed.type,
          description: PROBE_TAG,
          createdAt: seed.createdAt,
        },
        select: { id: true },
      });
      pointsIds.push(created.id);
    }
  }

  /** 旧链路口径：窗口内全量流水按升序在内存正推 */
  const legacySnapshots = (
    entriesAsc: ClubLedgerEntry[],
  ): Record<string, number> =>
    buildLedgerBalanceSnapshotsFromEntries({
      entries: entriesAsc,
      currentBalanceFen: EXPECTED_FINAL_BALANCE,
    });

  /**
   * 重建旧链路的窗口输入。
   *
   * 展示层的 `all` Tab 不含退款（退款只在 `consume` Tab 出现），单取一页无法还原
   * 改前 `listBalanceEntriesSince` 的无类型过滤窗口，故合并 all + consume 两页去重。
   */
  const loadFullWindowEntries = async (): Promise<ClubLedgerEntry[]> => {
    const [allPage, consumePage] = await Promise.all([
      recordQueryService.listLedgerEntries(storeId!, customerId!, {
        limit: 200,
        filterType: 'all',
      }),
      recordQueryService.listLedgerEntries(storeId!, customerId!, {
        limit: 200,
        filterType: 'consume',
      }),
    ]);

    const byId = new Map<string, ClubLedgerEntry>();
    for (const entry of [...allPage.items, ...consumePage.items]) {
      byId.set(entry.id, entry);
    }

    return [...byId.values()].sort(compareLedgerEntriesAsc);
  };

  it('储值流水：SQL 窗口聚合的快照与内存反推逐条相等，且等于手工期望值', async () => {
    if (storeId === null || customerId === null) {
      return;
    }

    const [allPage, windowEntries] = await Promise.all([
      recordQueryService.listLedgerEntries(storeId, customerId, {
        limit: 200,
        filterType: 'all',
      }),
      loadFullWindowEntries(),
    ]);

    expect(allPage.balanceWindow).not.toBeNull();
    const newSnapshots = buildLedgerBalanceSnapshotsFromWindow(
      allPage.balanceWindow!,
      EXPECTED_FINAL_BALANCE,
    );

    // 与旧算法逐条相等（只比对本页返回的 id：窗口聚合只回传本页条目）
    const legacy = legacySnapshots(windowEntries);
    const legacyOnPage = Object.fromEntries(
      Object.keys(newSnapshots).map((id) => [id, legacy[id]]),
    );
    expect(newSnapshots).toEqual(legacyOnPage);
    // 与手工期望值逐条相等（防止两条链路一起错）
    expect(newSnapshots[`bonus-${rechargeIds[1]}`]).toBe(
      EXPECTED_LEDGER_SNAPSHOT.bonus,
    );
    expect(newSnapshots[`recharge-${rechargeIds[0]}`]).toBe(
      EXPECTED_LEDGER_SNAPSHOT.recharge1,
    );
    expect(newSnapshots[`consume-${consumptionIds[0]}`]).toBe(
      EXPECTED_LEDGER_SNAPSHOT.consume1,
    );
    expect(newSnapshots[`recharge-${rechargeIds[2]}`]).toBe(
      EXPECTED_LEDGER_SNAPSHOT.recharge2,
    );
    // 退款不在 all Tab 展示（只在 consume Tab），其快照由跨 Tab 用例断言
    expect(newSnapshots[`refund-${rechargeIds[4]}`]).toBeUndefined();
    // 脏数据 0 金额赠送不产生快照
    expect(newSnapshots[`bonus-${rechargeIds[3]}`]).toBeUndefined();
    // 现金消费不进储值账户流水
    expect(newSnapshots[`consume-${consumptionIds[1]}`]).toBeUndefined();
  }, 60_000);

  it('储值流水 · 跨 Tab 过滤：窗口仍覆盖被过滤掉的另一类流水', async () => {
    if (storeId === null || customerId === null) {
      return;
    }

    const [consumePage, windowEntries] = await Promise.all([
      recordQueryService.listLedgerEntries(storeId, customerId, {
        limit: 200,
        filterType: 'consume',
      }),
      loadFullWindowEntries(),
    ]);

    const consumeSnapshots = buildLedgerBalanceSnapshotsFromWindow(
      consumePage.balanceWindow!,
      EXPECTED_FINAL_BALANCE,
    );
    const legacy = legacySnapshots(windowEntries);

    expect(consumePage.items.map((item) => item.type)).toEqual([
      'refund',
      'consume',
    ]);
    expect(consumePage.items.map((item) => consumeSnapshots[item.id])).toEqual([
      EXPECTED_LEDGER_SNAPSHOT.refund,
      EXPECTED_LEDGER_SNAPSHOT.consume1,
    ]);
    expect(consumeSnapshots[`consume-${consumptionIds[0]}`]).toBe(
      legacy[`consume-${consumptionIds[0]}`],
    );
  }, 60_000);

  it('积分流水：SQL 窗口聚合的快照与内存反推逐条相等，且等于手工期望值', async () => {
    if (storeId === null || customerId === null) {
      return;
    }

    const result = await pointsQueryService.listPointsRecords(
      storeId,
      customerId,
      'all',
      { limit: 200 },
    );

    expect(result.balanceWindow).not.toBeNull();
    const newSnapshots = buildPointsSnapshotsFromWindow(
      result.balanceWindow!,
      EXPECTED_POINTS_SNAPSHOT.p4,
    );
    const legacy = buildPointsSnapshotsFromRecords(
      result.items,
      EXPECTED_POINTS_SNAPSHOT.p4,
    );

    expect([...newSnapshots.entries()].sort((a, b) => a[0] - b[0])).toEqual(
      [...legacy.entries()].sort((a, b) => a[0] - b[0]),
    );
    expect(newSnapshots.get(pointsIds[0])).toBe(EXPECTED_POINTS_SNAPSHOT.p1);
    expect(newSnapshots.get(pointsIds[1])).toBe(EXPECTED_POINTS_SNAPSHOT.p2);
    expect(newSnapshots.get(pointsIds[2])).toBe(EXPECTED_POINTS_SNAPSHOT.p3);
    expect(newSnapshots.get(pointsIds[3])).toBe(EXPECTED_POINTS_SNAPSHOT.p4);
  }, 60_000);
});
