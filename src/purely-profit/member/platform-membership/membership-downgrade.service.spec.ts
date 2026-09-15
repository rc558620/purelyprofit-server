import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import {
  ADDITIONAL_BLOCKED_MESSAGE,
  MANUAL_ENTRY_DAILY_LIMIT,
  MANUAL_ENTRY_QUOTA_MESSAGE,
  MEMBERSHIP_EXPIRED_ERROR_CODE,
  MEMBERSHIP_EXPIRING_SOON_DAYS,
  SCAN_ORDER_BLOCKED_MESSAGE,
  SPACE_OPEN_BLOCKED_MESSAGE,
  MembershipDowngradeService,
} from './membership-downgrade.service';

/** 固定"当前时间"，让 remainingDays / 过期判定可预期 */
const NOW = new Date('2026-05-23T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const daysFromNow = (days: number): Date => new Date(NOW.getTime() + days * DAY_MS);

describe('MembershipDowngradeService', () => {
  let service: MembershipDowngradeService;

  const prismaService = {
    storeMembershipProfile: {
      findUnique: jest.fn(),
    },
    spaceSession: {
      count: jest.fn(),
    },
  };

  const redisService = {
    getJson: jest.fn(),
    setJson: jest.fn(),
    incr: jest.fn(),
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
    redisService.incr.mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipDowngradeService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<MembershipDowngradeService>(MembershipDowngradeService);
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
        service.assertStoreCanOrder(
          18,
          SCAN_ORDER_BLOCKED_MESSAGE,
          expiredAt,
        ),
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

      await expect(service.assertAdditionalEnabled(18)).resolves.toBeUndefined();
    });

    it('有效会员放行', async () => {
      mockProfile({
        currentPlanId: 'quarterly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(80),
      });

      await expect(service.assertAdditionalEnabled(18)).resolves.toBeUndefined();
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

  describe('assertManualEntryQuota', () => {
    it('未过期时不读计数直接放行', async () => {
      mockProfile({
        currentPlanId: 'yearly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(30),
      });

      await expect(service.assertManualEntryQuota(18)).resolves.toBe(0);
      // 未过期不应读计数；getJson 也会用于读降级态缓存，故限定到计数 key
      expect(redisService.getJson).not.toHaveBeenCalledWith(
        expect.stringContaining('membership:manual-entry-quota'),
      );
    });

    it('已过期且未达上限时返回已用数量', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      redisService.getJson.mockResolvedValue(2);

      await expect(service.assertManualEntryQuota(18)).resolves.toBe(2);
    });

    it('已过期且达到上限时拦截并带业务码', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      redisService.getJson.mockResolvedValue(MANUAL_ENTRY_DAILY_LIMIT);

      await expectMembershipExpired(
        service.assertManualEntryQuota(18),
        MANUAL_ENTRY_QUOTA_MESSAGE,
      );
    });

    it('计数为脏数据时按 0 处理，不误判为超限', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      redisService.getJson.mockResolvedValue('not-a-number');

      await expect(service.assertManualEntryQuota(18)).resolves.toBe(0);
    });
  });

  describe('incrementManualEntryCount', () => {
    it('未过期时不写计数', async () => {
      mockProfile({
        currentPlanId: 'yearly',
        startsAt: daysFromNow(-1),
        expiresAt: daysFromNow(30),
      });

      await service.incrementManualEntryCount(18);

      expect(redisService.incr).not.toHaveBeenCalled();
    });

    it('已过期时使用 Redis INCR 原子递增（而非 get-then-set）', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });

      await service.incrementManualEntryCount(18);

      // 必须用 INCR：并发下 get-then-set 会丢失更新，导致实际录单数 > 计数
      expect(redisService.incr).toHaveBeenCalledWith(
        expect.stringContaining('membership:manual-entry-quota:18'),
        expect.any(Number),
      );
      // 计数必须走 INCR；若出现「写计数」的 setJson 就说明退化成了 get-then-set。
      // 注意 setJson 也会用于写降级态缓存，因此断言需限定到计数 key。
      expect(redisService.setJson).not.toHaveBeenCalledWith(
        expect.stringContaining('membership:manual-entry-quota'),
        expect.anything(),
        expect.anything(),
      );
    });

    it('TTL 覆盖到次日，保证计数按自然日自动失效', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });

      await service.incrementManualEntryCount(18);

      const [, ttlSeconds] = redisService.incr.mock.calls[0];
      expect(ttlSeconds).toBeGreaterThan(0);
      // 不应超过 24 小时（按上海时区自然日切分，最长也就到次日 0 点）
      expect(ttlSeconds).toBeLessThanOrEqual(24 * 60 * 60);
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
      redisService.getJson.mockImplementation(async (key: string) =>
        key === CACHE_KEY
          ? { isExpired: false, level: 'yearly', expiredAt: daysFromNow(30).getTime(), remainingDays: 30 }
          : null,
      );

      const state = await service.getDowngradeState(18);

      expect(state.isExpired).toBe(false);
      // 缓存命中 → 不应查会员档案
      expect(prismaService.storeMembershipProfile.findUnique).not.toHaveBeenCalled();
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
      redisService.getJson.mockImplementation(async (key: string) =>
        key === CACHE_KEY
          ? { isExpired: false, level: 'yearly', expiredAt: null }
          : null,
      );

      const state = await service.getDowngradeState(18);

      expect(state.remainingDays).toBeGreaterThan(0);
      expect(prismaService.storeMembershipProfile.findUnique).toHaveBeenCalled();
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

  describe('手动录单计数的上海时区自然日分片', () => {
    const mockExpired = (): void => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
    };

    const lastIncrCall = (): [string, number] =>
      redisService.incr.mock.calls[redisService.incr.mock.calls.length - 1];

    it('同一上海自然日内多次递增复用同一个 key', async () => {
      mockExpired();
      // 上海 2026-09-13 10:00（UTC 02:00）
      jest.setSystemTime(Date.UTC(2026, 8, 13, 2, 0, 0));

      await service.incrementManualEntryCount(18);
      const [keyFirst] = lastIncrCall();

      // 同一天 22:00（UTC 14:00）
      jest.setSystemTime(Date.UTC(2026, 8, 13, 14, 0, 0));
      await service.incrementManualEntryCount(18);
      const [keySecond] = lastIncrCall();

      expect(keySecond).toBe(keyFirst);
    });

    it('跨过上海零点后切换到新的 key（额度自动重置）', async () => {
      mockExpired();
      // 上海 2026-09-13 23:59:59（UTC 15:59:59）—— 当日最后一秒
      jest.setSystemTime(Date.UTC(2026, 8, 13, 15, 59, 59));
      await service.incrementManualEntryCount(18);
      const [keyBeforeMidnight] = lastIncrCall();

      // 上海 2026-09-14 00:00:01（UTC 16:00:01）—— 次日第一秒
      jest.setSystemTime(Date.UTC(2026, 8, 13, 16, 0, 1));
      await service.incrementManualEntryCount(18);
      const [keyAfterMidnight] = lastIncrCall();

      expect(keyAfterMidnight).not.toBe(keyBeforeMidnight);
    });

    it('key 携带的日零点与 getShanghaiDayStartMs 一致', async () => {
      mockExpired();
      const now = Date.UTC(2026, 8, 13, 15, 59, 59);
      jest.setSystemTime(now);

      await service.incrementManualEntryCount(18);
      const [key] = lastIncrCall();

      // 上海 2026-09-13 的零点
      expect(key).toContain(String(getShanghaiDayStartMs(now)));
    });

    it('TTL 随零点临近而缩短：23:59 时约 1 秒，00:00 刚过时接近一整天', async () => {
      mockExpired();

      // 上海 23:59:59 → 距次日零点 1 秒
      jest.setSystemTime(Date.UTC(2026, 8, 13, 15, 59, 59));
      await service.incrementManualEntryCount(18);
      const [, ttlNearMidnight] = lastIncrCall();
      expect(ttlNearMidnight).toBe(1);

      // 上海 00:00:01 → 距次日零点约 24 小时
      jest.setSystemTime(Date.UTC(2026, 8, 13, 16, 0, 1));
      await service.incrementManualEntryCount(18);
      const [, ttlAfterMidnight] = lastIncrCall();
      expect(ttlAfterMidnight).toBeGreaterThan(23 * 60 * 60);
      expect(ttlAfterMidnight).toBeLessThanOrEqual(24 * 60 * 60);
    });
  });

  // ─── 计数组件故障时的可用性（降级策略） ────────────────────────────────

  describe('Redis 不可用时的降级', () => {
    it('读取计数失败时按未超限放行，不阻断商家录单', async () => {
      mockProfile({
        currentPlanId: 'monthly',
        startsAt: daysFromNow(-60),
        expiresAt: daysFromNow(-1),
      });
      redisService.getJson.mockRejectedValue(new Error('Redis connection lost'));

      // 计数组件故障不应让录单失败：每日限额是可追补的商业控制
      await expect(service.assertManualEntryQuota(18)).resolves.toBe(0);
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
