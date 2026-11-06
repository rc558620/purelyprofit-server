import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AllExceptionsFilter } from '../../bootstrap/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import { TelemetryValidationPipe } from '../../shared/telemetry-validation.pipe';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { DEFAULT_DAILY_CHECK_IN_POINTS } from '../../purely-profit/marketing/schemas/promotion-params.schema';
import { ClubPointsQueryService } from '../points/club-points-query.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  buildCheckInBusinessError,
  CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE,
  CHECK_IN_ACTIVITY_NOT_FOUND_CODE,
  CHECK_IN_ALREADY_DONE_CODE,
} from './club-check-in.errors';
import { ClubCheckInQueryService } from './club-check-in.query.service';
import { ClubCheckInService } from './club-check-in.service';

const NOW = new Date('2026-11-06T08:00:00.000Z');
const START_AT = new Date('2026-11-01T00:00:00.000Z');
const END_AT = new Date('2026-12-01T00:00:00.000Z');

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

const makeContext = (): ClubCurrentContext => {
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
      id: 11,
      name: '望京旗舰店',
      address: '',
      businessMode: 'general' as const,
      memberCareEnabled: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
};

const promotionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  enabled: true,
  startAt: START_AT,
  endAt: END_AT,
  params: { pointsPerCheckIn: 3 },
  ...overrides,
});

describe('ClubCheckInService · 幂等 / 边界 / 错误码', () => {
  let service: ClubCheckInService;
  let tx: TxMock;
  let redisService: { setIfAbsent: jest.Mock; del: jest.Mock };
  let cacheInvalidatorService: {
    invalidateMarketingCustomerDerived: jest.Mock;
  };
  let clubPointsQueryService: { findCustomerByStoreAndPhone: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    tx = {
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
    const prismaService = {
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
        .mockResolvedValue({ id: 55, points: 128 }),
    };
    tx.marketingPromotion.findFirst.mockResolvedValue(promotionRow());
    tx.marketingCustomer.findFirst.mockResolvedValue({
      id: 55,
      points: 128,
      memberId: null,
      clubUserId: 201,
    });
    tx.clubDailyCheckInRecord.findMany.mockResolvedValue([]);
    tx.clubDailyCheckInRecord.create.mockImplementation(() => ({
      id: 1,
      createdAt: new Date(),
    }));
    tx.marketingCustomer.update.mockResolvedValue({ id: 55, points: 131 });
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
        { provide: ClubPointsQueryService, useValue: clubPointsQueryService },
      ],
    }).compile();
    service = module.get<ClubCheckInService>(ClubCheckInService);
  });

  afterEach(() => jest.useRealTimers());

  const errorCodeOf = async (
    action: () => Promise<unknown>,
  ): Promise<string> => {
    try {
      await action();
      return 'NO_ERROR';
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code?: string;
      };
      return response.code ?? 'NO_CODE';
    }
  };

  it('活动在提交校验后、落账前被停用：整笔回滚且不发积分', async () => {
    tx.marketingPromotion.updateMany.mockResolvedValueOnce({ count: 0 });

    const code = await errorCodeOf(() =>
      service.submit(makeContext(), 'req-inactive'),
    );

    expect(code).toBe(CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE);
    expect(tx.clubDailyCheckInRecord.create).not.toHaveBeenCalled();
    expect(tx.marketingCustomer.update).not.toHaveBeenCalled();
    expect(tx.marketingPointsRecord.create).not.toHaveBeenCalled();
    expect(redisService.del).toHaveBeenCalledWith(
      'checkin:dedup:11:55:2026-11-06',
    );
  });

  it('重复签到（防抖占位已存在）拒绝且不写任何账务', async () => {
    redisService.setIfAbsent.mockResolvedValue(false);
    const code = await errorCodeOf(() =>
      service.submit(makeContext(), 'req-1'),
    );

    expect(code).toBe(CHECK_IN_ALREADY_DONE_CODE);
    expect(tx.clubDailyCheckInRecord.create).not.toHaveBeenCalled();
    expect(tx.marketingPointsRecord.create).not.toHaveBeenCalled();
    expect(tx.marketingCustomer.update).not.toHaveBeenCalled();
  });

  it('P2002 唯一约束冲突转 ALREADY_DONE，释放占位且不重复加分', async () => {
    tx.clubDailyCheckInRecord.create.mockRejectedValue({ code: 'P2002' });
    const code = await errorCodeOf(() =>
      service.submit(makeContext(), 'req-2'),
    );

    expect(code).toBe(CHECK_IN_ALREADY_DONE_CODE);
    expect(tx.marketingCustomer.update).not.toHaveBeenCalled();
    expect(tx.marketingPointsRecord.create).not.toHaveBeenCalled();
    expect(redisService.del).toHaveBeenCalledWith(
      'checkin:dedup:11:55:2026-11-06',
    );
  });

  it('并发两次提交只允许一次成功', async () => {
    redisService.setIfAbsent
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const results = await Promise.allSettled([
      service.submit(makeContext(), 'req-a'),
      service.submit(makeContext(), 'req-b'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(tx.marketingPointsRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.marketingPromotion.updateMany).toHaveBeenCalledTimes(1);
  });

  it('活动未配置 / 未开始 / 已结束 / 停用 / 无档案的错误码分类', async () => {
    tx.marketingPromotion.findFirst.mockResolvedValue(null);
    expect(await errorCodeOf(() => service.submit(makeContext(), 'r'))).toBe(
      CHECK_IN_ACTIVITY_NOT_FOUND_CODE,
    );

    const inactive = [
      promotionRow({ enabled: false }),
      promotionRow({ startAt: new Date('2026-11-07T00:00:00.000Z') }),
      promotionRow({ endAt: new Date('2026-11-05T00:00:00.000Z') }),
    ];
    for (const row of inactive) {
      tx.marketingPromotion.findFirst.mockResolvedValue(row);
      expect(await errorCodeOf(() => service.submit(makeContext(), 'r'))).toBe(
        CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE,
      );
    }

    tx.marketingPromotion.findFirst.mockResolvedValue(promotionRow());
    clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(null);
    expect(await errorCodeOf(() => service.submit(makeContext(), 'r'))).toBe(
      CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE,
    );
    expect(tx.clubDailyCheckInRecord.create).not.toHaveBeenCalled();
  });

  it('pointsPerCheckIn 缺失 / 非法回落默认 1，合法正整数原样发放', async () => {
    const dirtyParams: unknown[] = [
      {},
      { pointsPerCheckIn: 0 },
      { pointsPerCheckIn: -5 },
      { pointsPerCheckIn: 1.5 },
      { pointsPerCheckIn: '5' },
      { pointsPerCheckIn: null },
      { pointsPerCheckIn: Number.MAX_SAFE_INTEGER },
      'not-an-object',
    ];
    for (const params of dirtyParams) {
      tx.marketingPromotion.findFirst.mockResolvedValue(
        promotionRow({ params }),
      );
      const result = await service.submit(makeContext(), 'req-dirty');
      expect(result.awardedPoints).toBe(DEFAULT_DAILY_CHECK_IN_POINTS);
      expect(result.description).toBe('每日签到 +1 积分');
    }

    tx.marketingPromotion.findFirst.mockResolvedValue(
      promotionRow({ params: { pointsPerCheckIn: 5 } }),
    );
    const valid = await service.submit(makeContext(), 'req-valid');
    expect(valid.awardedPoints).toBe(5);
  });

  it('上海时区跨日边界：23:59:59.999 与 00:00 分属两个自然日', async () => {
    jest.setSystemTime(new Date('2026-11-06T15:59:59.999Z'));
    await service.submit(makeContext(), 'req-before');
    const before = tx.clubDailyCheckInRecord.create.mock.calls[0][0] as {
      data: { checkInDate: string };
    };

    tx.clubDailyCheckInRecord.create.mockClear();
    jest.setSystemTime(new Date('2026-11-06T16:00:00.000Z'));
    await service.submit(makeContext(), 'req-after');
    const after = tx.clubDailyCheckInRecord.create.mock.calls[0][0] as {
      data: { checkInDate: string };
    };

    expect(before.data.checkInDate).toBe('2026-11-06');
    expect(after.data.checkInDate).toBe('2026-11-07');
    expect(redisService.setIfAbsent.mock.calls[0][0]).not.toBe(
      redisService.setIfAbsent.mock.calls[1][0],
    );
  });

  it('三个业务码经 AllExceptionsFilter 落到响应体 code', () => {
    const codes = [
      CHECK_IN_ALREADY_DONE_CODE,
      CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE,
      CHECK_IN_ACTIVITY_NOT_FOUND_CODE,
    ] as const;
    for (const code of codes) {
      const response = { status: jest.fn().mockReturnThis(), send: jest.fn() };
      const host = {
        switchToHttp: () => ({
          getResponse: () => response,
          getRequest: () => ({
            method: 'POST',
            url: '/api/club/check-in',
            id: 'req-check',
          }),
        }),
      } as unknown as ArgumentsHost;
      const filter = new AllExceptionsFilter(true);
      filter['catch'](buildCheckInBusinessError(code), host);
      expect(response.send).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, code }),
      );
    }
  });

  it('POST 空 {} 通过全局 ValidationPipe（无 body DTO 时不误拒）', async () => {
    const pipe = new TelemetryValidationPipe();
    const transformed = await pipe.transform(
      {},
      {
        type: 'body',
        metatype: undefined,
      },
    );
    expect(transformed).toEqual({});
  });
});
