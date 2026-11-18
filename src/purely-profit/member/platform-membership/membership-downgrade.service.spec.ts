import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import {
  ADDITIONAL_BLOCKED_MESSAGE,
  MANUAL_ENTRY_QUOTA_MESSAGE,
  MEMBERSHIP_EXPIRED_ERROR_CODE,
  SCAN_ORDER_BLOCKED_MESSAGE,
  SPACE_OPEN_BLOCKED_MESSAGE,
} from './membership-downgrade.messages';
import {
  MANUAL_ENTRY_DAILY_LIMIT,
  MEMBERSHIP_EXPIRING_SOON_DAYS,
} from './membership-downgrade.constants';
import { MembershipDowngradeService } from './membership-downgrade.service';

/** 固定"当前时间"，让 remainingDays / 过期判定可预期 */
const NOW = new Date('2026-05-23T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const daysFromNow = (days: number): Date =>
  new Date(NOW.getTime() + days * DAY_MS);

describe('MembershipDowngradeService', () => {
  let service: MembershipDowngradeService;

  const prismaService = {
    storeMembershipProfile: {
      findUnique: jest.fn(),
    },
    spaceSession: {
      count: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  /** 额度预占/归还走 Lua 脚本，需要底层 client */
  const redisClient = {
    eval: jest.fn(),
  };

  const redisService = {
    getJson: jest.fn(),
    setJson: jest.fn(),
    getClient: jest.fn(() => redisClient),
  };

  /** 让 profile 查询返回指定会员档案（null 表示从未开通） */
  const mockProfile = (profile: unknown): void => {
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue(profile);
  };

  /** 断言抛出的异常同时满足文案与业务码（C 端依赖业务码区分引导弹窗） */
  const expectMembershipExpired = async (
    promise: Promise<unknown>,
    message: string,
  ): Promise<void> => {
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({
        message,
        code: MEMBERSHIP_EXPIRED_ERROR_CODE,
      }),
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    prismaService.spaceSession.count.mockResolvedValue(0);
    redisService.getJson.mockResolvedValue(null);
    redisService.setJson.mockResolvedValue(undefined);
    // 默认预占成功：[allowed, used] = [1, 1]
    redisClient.eval.mockResolvedValue([1, 1]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipDowngradeService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<MembershipDowngradeService>(
      MembershipDowngradeService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── isExpired：区分「到期」与「从未开通」 ──────────────────────────

  describe('getDowngradeState - isExpired 判定', () => {
    it('从未开通过（无档案）不算降级，免费账号保持原有权益', async () => {
      mockProfile(null);

      const state = await service.getDowngradeState(18);

      expect(state.isExpired).toBe(false);
      expect(state.level).toBe('free');
      expect(state.expiredAt).toBeNull();
      expect(state.remainingDays).toBe(0);
    });

    it('从未开通过（currentPlanId 为空）不算降级', async () => {
      mockProfile({
        currentPlanId: null,
        startsAt: null,
        expiresAt: null,
      });

      await expect(service.getDowngradeState(18)).resolves.toMatchObject({
        isExpired: false,
        level: 'free',
      });
    });

    it('曾经开通过且已过期时判定为降级', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-30),
      });

      const state = await service.getDowngradeState(18);

      expect(state.isExpired).toBe(true);
      expect(state.level).toBe('free');
      expect(state.remainingDays).toBe(0);
    });

    it('有效会员不算降级', async () => {
      mockProfile({
        currentPlanId: 'yearly',
        startsAt: daysFromNow(-100),
        expiresAt: daysFromNow(200),
      });

      const state = await service.getDowngradeState(18);

      expect(state.isExpired).toBe(false);
      expect(state.level).toBe('yearly');
      expect(state.remainingDays).toBe(200);
    });

    it('历史永久会员（yearly + 无到期时间）不算降级，不受到期限制', async () => {
      mockProfile({
        currentPlanId: 'yearly',
        startsAt: daysFromNow(-500),
        expiresAt: null,
      });

      const state = await service.getDowngradeState(18);

      expect(state.isExpired).toBe(false);
      expect(state.level).toBe('lifetime');
    });

    it('门店 id 非法时按未开通处理，不抛异常', async () => {
      await expect(service.getDowngradeState(0)).resolves.toMatchObject({
        isExpired: false,
        level: 'free',
      });
      expect(
        prismaService.storeMembershipProfile.findUnique,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── isExpiringSoon ────────────────────────────────────────────────

  describe('isExpiringSoon', () => {
    it('进入提醒窗口（第 10 天）时返回 true', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-20),
        expiresAt: daysFromNow(MEMBERSHIP_EXPIRING_SOON_DAYS),
      });

      expect(service.isExpiringSoon(await service.getDowngradeState(18))).toBe(
        true,
      );
    });

    it('超出提醒窗口时返回 false', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(MEMBERSHIP_EXPIRING_SOON_DAYS + 1),
      });

      expect(service.isExpiringSoon(await service.getDowngradeState(18))).toBe(
        false,
      );
    });

    it('已过期时返回 false（改由到期态承担提示）', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-5),
      });

      expect(service.isExpiringSoon(await service.getDowngradeState(18))).toBe(
        false,
      );
    });

    it('从未开通时返回 false，不误伤免费商家', async () => {
      mockProfile(null);

      expect(service.isExpiringSoon(await service.getDowngradeState(18))).toBe(
        false,
      );
    });
  });

  // ─── C 端停新单 ────────────────────────────────────────────────────

  describe('assertStoreCanOrder', () => {
    it('未过期时不拦截', async () => {
      mockProfile({
        currentPlanId: 'yearly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(30),
      });

      await expect(
        service.assertStoreCanOrder(18, SCAN_ORDER_BLOCKED_MESSAGE),
      ).resolves.toBeUndefined();
    });

    it('已过期且无在途流程时拦截', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-10),
      });

      await expectMembershipExpired(
        service.assertStoreCanOrder(18, SCAN_ORDER_BLOCKED_MESSAGE),
        SCAN_ORDER_BLOCKED_MESSAGE,
      );
    });

    it('到期之前已开始的流程（在途）放行，避免卡住已下单的顾客', async () => {
      const expiredAt = daysFromNow(-10);
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: expiredAt,
      });

      await expect(
        service.assertStoreCanOrder(
          18,
          SCAN_ORDER_BLOCKED_MESSAGE,
          new Date(expiredAt.getTime() - DAY_MS),
        ),
      ).resolves.toBeUndefined();
    });

    it('到期之后才开始的流程拦截', async () => {
      const expiredAt = daysFromNow(-10);
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: expiredAt,
      });

      await expectMembershipExpired(
        service.assertStoreCanOrder(
          18,
          SCAN_ORDER_BLOCKED_MESSAGE,
          new Date(expiredAt.getTime() + DAY_MS),
        ),
        SCAN_ORDER_BLOCKED_MESSAGE,
      );
    });

    it('恰好等于到期时刻开始的流程视为在途，放行', async () => {
      const expiredAt = daysFromNow(-10);
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: expiredAt,
      });

      await expect(
        service.assertStoreCanOrder(18, SCAN_ORDER_BLOCKED_MESSAGE, expiredAt),
      ).resolves.toBeUndefined();
    });
  });

  // ─── B 端追加点单 ──────────────────────────────────────────────────

  describe('assertAdditionalEnabled', () => {
    it('已过期时拦截并带业务码', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });

      await expectMembershipExpired(
        service.assertAdditionalEnabled(18),
        ADDITIONAL_BLOCKED_MESSAGE,
      );
    });

    it('从未开通过的免费账号放行（免费版本就含该能力）', async () => {
      mockProfile(null);

      await expect(
        service.assertAdditionalEnabled(18),
      ).resolves.toBeUndefined();
    });

    it('有效会员放行', async () => {
      mockProfile({
        currentPlanId: 'quarterly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(80),
      });

      await expect(
        service.assertAdditionalEnabled(18),
      ).resolves.toBeUndefined();
    });
  });

  // ─── B 端空间同时开台数 ────────────────────────────────────────────

  describe('assertSpaceCanOpen', () => {
    it('未过期时不查询会话直接放行', async () => {
      mockProfile({
        currentPlanId: 'yearly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(30),
      });

      await expect(service.assertSpaceCanOpen(18)).resolves.toBeUndefined();
      expect(prismaService.spaceSession.count).not.toHaveBeenCalled();
    });

    it('已过期且已有 1 个开台时拦截', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      prismaService.spaceSession.count.mockResolvedValue(1);

      await expectMembershipExpired(
        service.assertSpaceCanOpen(18),
        SPACE_OPEN_BLOCKED_MESSAGE,
      );
    });

    it('已过期但无开台时允许开第一个台', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      prismaService.spaceSession.count.mockResolvedValue(0);

      await expect(service.assertSpaceCanOpen(18)).resolves.toBeUndefined();
    });
  });

  // ─── B 端手动录单每日限额 ──────────────────────────────────────────

  describe('consumeManualEntryQuota', () => {
    const mockExpired = (): void => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
    };

    it('未过期时不占用额度', async () => {
      mockProfile({
        currentPlanId: 'yearly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(30),
      });

      await expect(service.consumeManualEntryQuota(18)).resolves.toBe(false);
      // 未过期连脚本都不该执行
      expect(redisClient.eval).not.toHaveBeenCalled();
    });

    it('已过期且未达上限时原子预占并返回 true', async () => {
      mockExpired();
      redisClient.eval.mockResolvedValue([1, 3]);

      await expect(service.consumeManualEntryQuota(18)).resolves.toBe(true);

      // 判定与递增必须在同一段 Lua 内完成：key / 上限 / TTL 作为参数传入
      const [, numKeys, key, limit, ttlSeconds] = redisClient.eval.mock
        .calls[0] as [string, number, string, number, number];
      expect(numKeys).toBe(1);
      expect(key).toContain('membership:manual-entry-quota:18');
      expect(limit).toBe(MANUAL_ENTRY_DAILY_LIMIT);
      expect(ttlSeconds).toBeGreaterThan(0);
      // 不应超过 24 小时（按上海时区自然日切分，最长也就到次日 0 点）
      expect(ttlSeconds).toBeLessThanOrEqual(24 * 60 * 60);
    });

    it('已过期且达到上限时拦截并带业务码', async () => {
      mockExpired();
      redisClient.eval.mockResolvedValue([0, MANUAL_ENTRY_DAILY_LIMIT]);

      await expectMembershipExpired(
        service.consumeManualEntryQuota(18),
        MANUAL_ENTRY_QUOTA_MESSAGE,
      );
    });
  });

  describe('releaseManualEntryQuota', () => {
    it('归还一次预占（DECR 而非删除 key，避免重复归还放大额度）', async () => {
      redisClient.eval.mockResolvedValue(1);

      await service.releaseManualEntryQuota(18);

      const [script, numKeys, key] = redisClient.eval.mock.calls[0] as [
        string,
        number,
        string,
      ];
      expect(numKeys).toBe(1);
      expect(key).toContain('membership:manual-entry-quota:18');
      expect(script).toContain('DECR');
    });
  });

  // ─── 降级态缓存（高频加购路径的性能保障） ──────────────────────────────

  describe('降级态缓存', () => {
    const CACHE_KEY = 'profit:platform-membership:downgrade-state:store:18';

    it('缓存命中时不再回源查库（加购是高频操作）', async () => {
      mockProfile({
        currentPlanId: 'yearly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(30),
      });
      redisService.getJson.mockImplementation((key: string) =>
        key === CACHE_KEY
          ? {
              isExpired: false,
              level: 'yearly',
              expiredAt: daysFromNow(30).getTime(),
              remainingDays: 30,
            }
          : null,
      );

      const state = await service.getDowngradeState(18);

      expect(state.isExpired).toBe(false);
      // 缓存命中 → 不应查会员档案
      expect(
        prismaService.storeMembershipProfile.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('未命中时回源并把结果写入缓存', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      redisService.getJson.mockResolvedValue(null);

      const state = await service.getDowngradeState(18);

      expect(state.isExpired).toBe(true);
      expect(redisService.setJson).toHaveBeenCalledWith(
        CACHE_KEY,
        expect.objectContaining({ isExpired: true, level: 'free' }),
        expect.any(Number),
      );
    });

    it('缓存 key 遵循平台会员派生 pattern，确保续费时能按 pattern 清除', async () => {
      mockProfile({
        currentPlanId: 'yearly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(30),
      });
      redisService.getJson.mockResolvedValue(null);

      await service.getDowngradeState(18);

      const [cacheKey] = redisService.setJson.mock.calls[0];
      // invalidatePlatformMembershipDerived 使用 profit:platform-membership:*:store:{id}
      expect(cacheKey).toMatch(/^profit:platform-membership:.+:store:18$/);
    });

    it('缓存内容不完整时丢弃并回源，避免半截数据被当成有效状态', async () => {
      mockProfile({
        currentPlanId: 'yearly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(30),
      });
      // 缺少 remainingDays 字段
      redisService.getJson.mockImplementation((key: string) =>
        key === CACHE_KEY
          ? { isExpired: false, level: 'yearly', expiredAt: null }
          : null,
      );

      const state = await service.getDowngradeState(18);

      expect(state.remainingDays).toBeGreaterThan(0);
      expect(
        prismaService.storeMembershipProfile.findUnique,
      ).toHaveBeenCalled();
    });

    it('Redis 读取缓存失败时回源，不因缓存故障影响下单判定', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      redisService.getJson.mockRejectedValue(new Error('Redis read timeout'));

      const state = await service.getDowngradeState(18);

      expect(state.isExpired).toBe(true);
    });

    it('写入缓存失败不影响本次判定结果', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      redisService.getJson.mockResolvedValue(null);
      redisService.setJson.mockRejectedValue(new Error('Redis write timeout'));

      await expect(service.getDowngradeState(18)).resolves.toMatchObject({
        isExpired: true,
      });
    });
  });

  // ─── 计数的上海时区自然日分片 ──────────────────────────────────────────
  //
  // 手动录单限额是「每日 5 单」，"日"必须按上海时区自然日切分。
  // 若误用 UTC 或服务器本地时区，商家会在北京时间早上 8 点前发现额度莫名其妙
  // 没重置（UTC 分片）或提前重置（服务器非 UTC 时）。

  describe('手动录单额度的上海时区自然日分片', () => {
    const mockExpired = (): void => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
    };

    /** 取最后一次预占脚本调用的 key 与 TTL（eval(script, numKeys, key, limit, ttl)） */
    const lastEvalCall = (): { key: string; ttl: number } => {
      const calls = redisClient.eval.mock.calls;
      const [, , key, , ttl] = calls[calls.length - 1] as [
        string,
        number,
        string,
        number,
        number,
      ];
      return { key, ttl };
    };

    it('同一上海自然日内多次预占复用同一个 key', async () => {
      mockExpired();
      // 上海 2026-09-13 10:00（UTC 02:00）
      jest.setSystemTime(Date.UTC(2026, 8, 13, 2, 0, 0));

      await service.consumeManualEntryQuota(18);
      const { key: keyFirst } = lastEvalCall();

      // 同一天 22:00（UTC 14:00）
      jest.setSystemTime(Date.UTC(2026, 8, 13, 14, 0, 0));
      await service.consumeManualEntryQuota(18);
      const { key: keySecond } = lastEvalCall();

      expect(keySecond).toBe(keyFirst);
    });

    it('跨过上海零点后切换到新的 key（额度自动重置）', async () => {
      mockExpired();
      // 上海 2026-09-13 23:59:59（UTC 15:59:59）—— 当日最后一秒
      jest.setSystemTime(Date.UTC(2026, 8, 13, 15, 59, 59));
      await service.consumeManualEntryQuota(18);
      const { key: keyBeforeMidnight } = lastEvalCall();

      // 上海 2026-09-14 00:00:01（UTC 16:00:01）—— 次日第一秒
      jest.setSystemTime(Date.UTC(2026, 8, 13, 16, 0, 1));
      await service.consumeManualEntryQuota(18);
      const { key: keyAfterMidnight } = lastEvalCall();

      expect(keyAfterMidnight).not.toBe(keyBeforeMidnight);
    });

    it('key 携带的日零点与 getShanghaiDayStartMs 一致', async () => {
      mockExpired();
      const now = Date.UTC(2026, 8, 13, 15, 59, 59);
      jest.setSystemTime(now);

      await service.consumeManualEntryQuota(18);
      const { key } = lastEvalCall();

      // 上海 2026-09-13 的零点
      expect(key).toContain(String(getShanghaiDayStartMs(now)));
    });

    it('TTL 随零点临近而缩短：23:59 时约 1 秒，00:00 刚过时接近一整天', async () => {
      mockExpired();

      // 上海 23:59:59 → 距次日零点 1 秒
      jest.setSystemTime(Date.UTC(2026, 8, 13, 15, 59, 59));
      await service.consumeManualEntryQuota(18);
      const { ttl: ttlNearMidnight } = lastEvalCall();
      expect(ttlNearMidnight).toBe(1);

      // 上海 00:00:01 → 距次日零点约 24 小时
      jest.setSystemTime(Date.UTC(2026, 8, 13, 16, 0, 1));
      await service.consumeManualEntryQuota(18);
      const { ttl: ttlAfterMidnight } = lastEvalCall();
      expect(ttlAfterMidnight).toBeGreaterThan(23 * 60 * 60);
      expect(ttlAfterMidnight).toBeLessThanOrEqual(24 * 60 * 60);
    });
  });

  // ─── 时钟源漂移探测（观测） ────────────────────────────────────────────
  //
  // 到期判定用应用时钟，而到期时间可能由 DB 时钟写入的字段（订单 createdAt 走
  // Prisma @default(now())）推导。两者偏差时判定就是跨时钟源比较，门店可能被
  // 提前判过期。单机 cluster 部署进程间漂移恒为 0，所以这只在「应用机 ≠ DB 机
  // 时钟不一致」或将来多机部署时才报得出——先做成可观测，再决定是否值得
  // 为统一时间源付出全链路改造的代价。

  describe('时钟源漂移探测', () => {
    const validProfile = (): void => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-20),
        expiresAt: daysFromNow(10),
      });
    };

    it('DB 明显慢于应用时告警（这是会把到期时间算早、提前判过期的方向）', async () => {
      validProfile();
      const driftedDbNow = new Date(NOW.getTime() - 30 * 1000);
      prismaService.$queryRaw.mockResolvedValue([{ now: driftedDbNow }]);
      const warnSpy = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await service.getDowngradeState(18);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('时钟源偏差'),
      );
    });

    it('DB 明显快于应用时也告警', async () => {
      validProfile();
      const driftedDbNow = new Date(NOW.getTime() + 30 * 1000);
      prismaService.$queryRaw.mockResolvedValue([{ now: driftedDbNow }]);
      const warnSpy = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await service.getDowngradeState(18);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('时钟源偏差'),
      );
    });

    it('DB 与应用时钟一致时不告警', async () => {
      validProfile();
      prismaService.$queryRaw.mockResolvedValue([{ now: new Date(NOW) }]);
      const warnSpy = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await service.getDowngradeState(18);

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('时钟源偏差'),
      );
    });

    it('探测失败不影响本次判定（不因观测丢可用性）', async () => {
      validProfile();
      prismaService.$queryRaw.mockRejectedValue(new Error('db down'));

      await expect(service.getDowngradeState(18)).resolves.toMatchObject({
        isExpired: false,
      });
    });

    it('探测按 5 分钟节流，不为每次判定都查一次库', async () => {
      validProfile();
      prismaService.$queryRaw.mockResolvedValue([{ now: new Date(NOW) }]);
      // 缓存未命中才会走到探测：连续三次调用只应产生一次 $queryRaw
      redisService.getJson.mockResolvedValue(null);

      await service.getDowngradeState(18);
      await service.getDowngradeState(18);
      await service.getDowngradeState(18);

      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 计数组件故障时的可用性（降级策略） ────────────────────────────────

  describe('Redis 不可用时的降级', () => {
    it('额度预占脚本失败时按未超限放行，不阻断商家录单', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      redisClient.eval.mockRejectedValue(new Error('Redis connection lost'));

      // 计数组件故障不应让录单失败：每日限额是可追补的商业控制
      await expect(service.consumeManualEntryQuota(18)).resolves.toBe(true);
    });

    it('获取用量失败时返回 0，不影响页面展示', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      redisService.getJson.mockRejectedValue(new Error('Redis down'));

      await expect(service.getManualEntryUsage(18)).resolves.toEqual({
        used: 0,
        limit: MANUAL_ENTRY_DAILY_LIMIT,
      });
    });
  });

  describe('getManualEntryUsage', () => {
    it('已过期时返回已用与上限', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      redisService.getJson.mockResolvedValue(1);

      await expect(service.getManualEntryUsage(18)).resolves.toEqual({
        used: 1,
        limit: MANUAL_ENTRY_DAILY_LIMIT,
      });
    });

    it('未过期时返回 0 且不读 Redis', async () => {
      mockProfile(null);

      await expect(service.getManualEntryUsage(18)).resolves.toEqual({
        used: 0,
        limit: MANUAL_ENTRY_DAILY_LIMIT,
      });
      // 同上：限定到计数 key，避免把降级态缓存的读取算进来
      expect(redisService.getJson).not.toHaveBeenCalledWith(
        expect.stringContaining('membership:manual-entry-quota'),
      );
    });
  });
});
