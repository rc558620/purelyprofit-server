import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubPointsQueryService } from '../points/club-points-query.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubCheckInQueryService } from './club-check-in.query.service';
import { ClubCheckInService } from './club-check-in.service';

const NOW = new Date('2026-11-06T08:00:00.000Z');
const START_AT = new Date('2026-11-01T00:00:00.000Z');
const END_AT = new Date('2026-12-01T00:00:00.000Z');
const CUSTOMER_POINTS = 128;

interface TxMock {
  marketingCustomer: { findFirst: jest.Mock; update: jest.Mock };
  marketingPromotion: {
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  marketingPointsRecord: { create: jest.Mock };
  memberPointsLog: { create: jest.Mock };
  clubDailyCheckInRecord: { create: jest.Mock; findMany: jest.Mock };
}

function createTxMock(): TxMock {
  return {
    marketingCustomer: { findFirst: jest.fn(), update: jest.fn() },
    marketingPromotion: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    marketingPointsRecord: { create: jest.fn() },
    memberPointsLog: { create: jest.fn() },
    clubDailyCheckInRecord: { create: jest.fn(), findMany: jest.fn() },
  };
}

function makeContext(storeId = 11): ClubCurrentContext {
  const user: AuthenticatedUser = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '会员用户',
    createdAt: NOW,
    updatedAt: NOW,
    lastActiveAt: null,
    accountScope: 'purely_club',
    currentMembership: null,
  };
  return {
    user,
    store: {
      id: storeId,
      name: '望京旗舰店',
      address: '北京市朝阳区',
      businessMode: 'general' as const,
      memberCareEnabled: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

describe('ClubCheckInService · 状态与落账主链路', () => {
  let service: ClubCheckInService;
  let tx: TxMock;
  let prismaService: Record<string, unknown>;
  let redisService: {
    setIfAbsent: jest.Mock;
    del: jest.Mock;
  };
  let cacheInvalidatorService: {
    invalidateMarketingCustomerDerived: jest.Mock;
  };
  let clubPointsQueryService: { findCustomerByStoreAndPhone: jest.Mock };

  const promotionRow = (overrides: Record<string, unknown> = {}) => ({
    id: 7,
    enabled: true,
    startAt: START_AT,
    endAt: END_AT,
    params: { pointsPerCheckIn: 3 },
    ...overrides,
  });

  const customerDetail = (overrides: Record<string, unknown> = {}) => ({
    id: 55,
    points: CUSTOMER_POINTS,
    memberId: 88,
    clubUserId: 201,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    tx = createTxMock();

    prismaService = {
      ...tx,
      $transaction: jest.fn(
        async (callback: (client: TxMock) => Promise<unknown>) => callback(tx),
      ),
    };
    redisService = {
      setIfAbsent: jest.fn().mockResolvedValue(true),
      del: jest.fn().mockResolvedValue(undefined),
    };
    cacheInvalidatorService = {
      invalidateMarketingCustomerDerived: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    clubPointsQueryService = {
      findCustomerByStoreAndPhone: jest
        .fn()
        .mockResolvedValue({ id: 55, points: CUSTOMER_POINTS }),
    };

    tx.marketingPromotion.findFirst.mockResolvedValue(promotionRow());
    tx.marketingCustomer.findFirst.mockResolvedValue(customerDetail());
    tx.clubDailyCheckInRecord.findMany.mockResolvedValue([
      { checkInDate: '2026-11-04' },
      { checkInDate: '2026-11-05' },
    ]);
    tx.clubDailyCheckInRecord.create.mockResolvedValue({
      id: 1,
      createdAt: NOW,
    });
    tx.marketingCustomer.update.mockResolvedValue({
      id: 55,
      points: CUSTOMER_POINTS + 3,
    });
    tx.marketingPointsRecord.create.mockResolvedValue({});
    tx.memberPointsLog.create.mockResolvedValue({});
    tx.marketingPromotion.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubCheckInService,
        ClubCheckInQueryService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: CacheInvalidatorService, useValue: cacheInvalidatorService },
        {
          provide: ClubPointsQueryService,
          useValue: clubPointsQueryService,
        },
      ],
    }).compile();
    service = module.get<ClubCheckInService>(ClubCheckInService);
  });

  afterEach(() => jest.useRealTimers());

  it('status 逐字段满足契约：严格 boolean、毫秒 number、YYYY-MM-DD 数组', async () => {
    const status = await service.getStatus(makeContext());

    expect(status).toEqual({
      activityEnabled: true,
      activityStartAt: START_AT.getTime(),
      activityEndAt: END_AT.getTime(),
      todayCheckedIn: false,
      continuousDays: 2,
      pointsPerCheckIn: 3,
      pointsBalance: CUSTOMER_POINTS,
      checkedDates: ['2026-11-04', '2026-11-05'],
      serverTime: NOW.getTime(),
    });
    expect(typeof status.activityEnabled).toBe('boolean');
    expect(typeof status.todayCheckedIn).toBe('boolean');
    expect(status.serverTime).toBeGreaterThan(1_700_000_000_000);
    expect(
      status.checkedDates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ).toBe(true);
  });

  it('status 今日已签时连续天数从今日回溯，未签时从昨日回溯', async () => {
    tx.clubDailyCheckInRecord.findMany.mockResolvedValue([
      { checkInDate: '2026-11-04' },
      { checkInDate: '2026-11-05' },
      { checkInDate: '2026-11-06' },
    ]);
    const todayStatus = await service.getStatus(makeContext());
    expect(todayStatus.todayCheckedIn).toBe(true);
    expect(todayStatus.continuousDays).toBe(3);

    tx.clubDailyCheckInRecord.findMany.mockResolvedValue([
      { checkInDate: '2026-11-04' },
      { checkInDate: '2026-11-05' },
    ]);
    const pendingStatus = await service.getStatus(makeContext());
    expect(pendingStatus.todayCheckedIn).toBe(false);
    expect(pendingStatus.continuousDays).toBe(2);
  });

  it('status 活动不存在 / 停用 / 未开始 / 已结束 / 无档案均返回合法空态', async () => {
    const inactiveRows = [
      null,
      promotionRow({ enabled: false }),
      promotionRow({ startAt: new Date('2026-11-07T00:00:00.000Z') }),
      promotionRow({ endAt: new Date('2026-11-05T00:00:00.000Z') }),
    ];
    for (const row of inactiveRows) {
      tx.marketingPromotion.findFirst.mockResolvedValue(row);
      const status = await service.getStatus(makeContext());
      expect(status.activityEnabled).toBe(false);
      expect(status.activityStartAt).toBeUndefined();
      expect(status.activityEndAt).toBeUndefined();
      expect(status.todayCheckedIn).toBe(false);
      expect(status.continuousDays).toBe(0);
      expect(status.pointsPerCheckIn).toBe(0);
      expect(status.checkedDates).toEqual([]);
      expect(status.serverTime).toBe(NOW.getTime());
      expect(status.pointsBalance).toBe(CUSTOMER_POINTS);
    }

    tx.marketingPromotion.findFirst.mockResolvedValue(promotionRow());
    tx.marketingCustomer.findFirst.mockClear();
    clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(null);
    const noCustomer = await service.getStatus(makeContext());
    expect(noCustomer.activityEnabled).toBe(false);
    expect(noCustomer.pointsBalance).toBe(0);
    expect(tx.marketingCustomer.findFirst).not.toHaveBeenCalled();
  });

  it('submit 首次签到：余额、积分流水、签到记录、审计流水与 usageCount 一致', async () => {
    const result = await service.submit(makeContext(), 'req-1');

    expect(result).toEqual({
      checkedInAt: NOW.getTime(),
      awardedPoints: 3,
      pointsBalance: CUSTOMER_POINTS + 3,
      continuousDays: 3,
      description: '每日签到 +3 积分',
    });
    expect(tx.clubDailyCheckInRecord.create).toHaveBeenCalledWith({
      data: {
        storeId: 11,
        customerId: 55,
        clubUserId: 201,
        memberId: 88,
        promotionId: 7,
        checkInDate: '2026-11-06',
        pointsAwarded: 3,
      },
      select: { id: true, createdAt: true },
    });
    expect(tx.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 55, storeId: 11, deletedAt: null },
      data: { points: { increment: 3 } },
      select: { id: true, points: true },
    });
    expect(tx.marketingPointsRecord.create).toHaveBeenCalledWith({
      data: {
        storeId: 11,
        customerId: 55,
        amount: 3,
        type: 'earn',
        description: '每日签到 +3 积分',
      },
    });
    expect(tx.memberPointsLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: 88,
        storeId: 11,
        source: 'check_in',
        changeType: 'increase',
        changeAmount: 3,
        beforePoints: CUSTOMER_POINTS,
        afterPoints: CUSTOMER_POINTS + 3,
      }),
    });
    expect(tx.marketingPromotion.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 7, enabled: true }),
      data: { usageCount: { increment: 1 } },
    });
    expect(
      Object.keys(
        (tx.marketingPromotion.updateMany.mock.calls[0][0] as { data: object })
          .data,
      ),
    ).not.toContain('totalDiscount');
  });

  it('submit 事务后失效会员派生缓存与防抖 key 带业务前缀', async () => {
    await service.submit(makeContext(), 'req-2');

    expect(
      cacheInvalidatorService.invalidateMarketingCustomerDerived,
    ).toHaveBeenCalledWith(11);
    const [key, , ttl] = redisService.setIfAbsent.mock.calls[0] as [
      string,
      string,
      number,
    ];
    expect(key).toBe('checkin:dedup:11:55:2026-11-06');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86_400);
  });

  it('memberId 为空时不写 MemberPointsLog，其余账务仍一致', async () => {
    tx.marketingCustomer.findFirst.mockResolvedValue(
      customerDetail({ memberId: null }),
    );
    const result = await service.submit(makeContext(), 'req-3');

    expect(result.pointsBalance).toBe(CUSTOMER_POINTS + 3);
    expect(tx.memberPointsLog.create).not.toHaveBeenCalled();
    expect(tx.marketingPointsRecord.create).toHaveBeenCalledTimes(1);
  });

  it('越权隔离：所有查询与写入都带 context.store.id', async () => {
    await service.submit(makeContext(99), 'req-4');

    expect(tx.marketingPromotion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ storeId: 99, type: 'daily_check_in' }),
      }),
    );
    expect(
      clubPointsQueryService.findCustomerByStoreAndPhone,
    ).toHaveBeenCalledWith(99, '13800138000', 201);
    expect(tx.marketingCustomer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 55,
          storeId: 99,
          deletedAt: null,
        }),
      }),
    );
    expect(
      (
        tx.clubDailyCheckInRecord.create.mock.calls[0][0] as {
          data: { storeId: number };
        }
      ).data.storeId,
    ).toBe(99);
  });

  it('缓存失效失败不影响已落账结果：仍返回成功且不释放防抖占位', async () => {
    cacheInvalidatorService.invalidateMarketingCustomerDerived.mockRejectedValue(
      new Error('redis unavailable'),
    );

    const result = await service.submit(makeContext(), 'req-cache-fail');

    expect(result.pointsBalance).toBe(CUSTOMER_POINTS + 3);
    expect(result.description).toBe('每日签到 +3 积分');
    expect(tx.marketingPointsRecord.create).toHaveBeenCalledTimes(1);
    expect(redisService.del).not.toHaveBeenCalled();
  });

  it('status 只读不写：不触发事务、不占用防抖占位、不失效缓存', async () => {
    await service.getStatus(makeContext());

    expect(prismaService.$transaction).not.toHaveBeenCalled();
    expect(redisService.setIfAbsent).not.toHaveBeenCalled();
    expect(
      cacheInvalidatorService.invalidateMarketingCustomerDerived,
    ).not.toHaveBeenCalled();
  });
});
