import { DAY_MS } from './platform-membership.constants';
import {
  calcRemainingDays,
  isMembershipDowngraded,
  isMembershipProfileActive,
  resolveMembershipExpiry,
  resolveMembershipLevel,
} from './membership-expiry.utils';

// AGES（lifetime）档位按 730 天有效期售卖，名称虽叫「永久」，但仍会真实到期。
// 首页续费横幅/弹窗只认 isActive + remainingDays，两处口径破一即静默，
// 所以这里把「有效期内 / 临期 / 已过期 / 真永久（expiresAt 为空）」四态钉死。
describe('membership-expiry.utils', () => {
  const NOW = new Date('2026-05-23T12:00:00.000Z').getTime();
  const daysFromNow = (days: number): Date => new Date(NOW + days * DAY_MS);

  describe('isMembershipProfileActive', () => {
    it('AGES(lifetime) 在有效期内视为会员', () => {
      expect(
        isMembershipProfileActive(
          {
            currentPlanId: 'lifetime',
            startsAt: daysFromNow(-700),
            expiresAt: daysFromNow(30),
          },
          NOW,
        ),
      ).toBe(true);
    });

    it('AGES(lifetime) 已过 expiresAt 时不再视为会员', () => {
      expect(
        isMembershipProfileActive(
          {
            currentPlanId: 'lifetime',
            startsAt: daysFromNow(-731),
            expiresAt: daysFromNow(-1),
          },
          NOW,
        ),
      ).toBe(false);
    });

    it('AGES(lifetime) 临期（剩余 10 天内）仍视为会员，交由首页弹续费提醒', () => {
      expect(
        isMembershipProfileActive(
          {
            currentPlanId: 'lifetime',
            startsAt: daysFromNow(-720),
            expiresAt: daysFromNow(8),
          },
          NOW,
        ),
      ).toBe(true);
    });

    it('expiresAt 为空的 lifetime 属于历史真永久会员，不参与到期判定', () => {
      expect(
        isMembershipProfileActive(
          {
            currentPlanId: 'lifetime',
            startsAt: daysFromNow(-900),
            expiresAt: null,
          },
          NOW,
        ),
      ).toBe(true);
    });

    it('常规档位仍按 expiresAt 判定（回归）', () => {
      const base = {
        currentPlanId: 'monthly' as const,
        startsAt: daysFromNow(-20),
      };

      expect(
        isMembershipProfileActive({ ...base, expiresAt: daysFromNow(10) }, NOW),
      ).toBe(true);
      expect(
        isMembershipProfileActive({ ...base, expiresAt: daysFromNow(-1) }, NOW),
      ).toBe(false);
    });
  });

  describe('calcRemainingDays', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('AGES(lifetime) 按 expireAt 返回真实剩余天数', () => {
      expect(
        calcRemainingDays({
          currentPlanId: 'lifetime',
          startsAt: daysFromNow(-722),
          expiresAt: daysFromNow(8),
        }),
      ).toBe(8);
    });

    it('AGES(lifetime) 到期后剩余天数归零，配合 isActive=false 触发已到期横幅', () => {
      expect(
        calcRemainingDays({
          currentPlanId: 'lifetime',
          startsAt: daysFromNow(-731),
          expiresAt: daysFromNow(-1),
        }),
      ).toBe(0);
    });

    it('expiresAt 为空的 lifetime 不产生剩余天数，不打扰商家', () => {
      expect(
        calcRemainingDays({
          currentPlanId: 'lifetime',
          startsAt: daysFromNow(-900),
          expiresAt: null,
        }),
      ).toBe(0);
    });
  });

  // ─── expiresAt 缺失时的兜底推导 ─────────────────────────────────────
  //
  // 这一段是「数据缺失」回归区。过去 expiresAt 为空时 monthly/quarterly 会被
  // 直接判成过期（掐掉门店营业），yearly 反而被判成永久（白送权益）——
  // 同一个字段缺失，两个档位的处理方向完全相反。
  describe('expiresAt 缺失时按 startsAt + 套餐时长兜底', () => {
    it('monthly 缺失 expiresAt 时按 30 天推导，有效期内仍是会员', () => {
      const profile = {
        currentPlanId: 'monthly' as const,
        startsAt: daysFromNow(-10),
        expiresAt: null,
      };

      expect(resolveMembershipExpiry(profile).source).toBe('derived');
      expect(calcRemainingDays(profile, NOW)).toBe(20);
      expect(isMembershipProfileActive(profile, NOW)).toBe(true);
    });

    it('monthly 缺失 expiresAt 时超过 30 天仍会正常到期（不再永久有效）', () => {
      const profile = {
        currentPlanId: 'monthly' as const,
        startsAt: daysFromNow(-40),
        expiresAt: null,
      };

      expect(resolveMembershipLevel(profile, NOW)).toBe('free');
      expect(isMembershipProfileActive(profile, NOW)).toBe(false);
    });

    it('quarterly 缺失 expiresAt 时按 90 天推导', () => {
      expect(
        calcRemainingDays(
          {
            currentPlanId: 'quarterly',
            startsAt: daysFromNow(-30),
            expiresAt: null,
          },
          NOW,
        ),
      ).toBe(60);
    });

    it('yearly + 无 startsAt + 无 expiresAt 不再被当成永久会员', () => {
      // 回归：过去这条路径用 Date.now() 当基准推导出「现在 + 730 天」，
      // 恒在未来 → 档位解析为 yearly → 残缺档案静默变成永久会员。
      const profile = {
        currentPlanId: 'yearly' as const,
        startsAt: null,
        expiresAt: null,
      };

      expect(resolveMembershipExpiry(profile).source).toBe('none');
      expect(resolveMembershipLevel(profile, NOW)).toBe('free');
    });

    it('推导不出到期时间时不按其永久会员处理，也不产生剩余天数', () => {
      const profile = {
        currentPlanId: 'monthly' as const,
        startsAt: null,
        expiresAt: null,
      };

      expect(calcRemainingDays(profile, NOW)).toBe(0);
      expect(isMembershipProfileActive(profile, NOW)).toBe(false);
    });
  });

  // ─── 降级态 ────────────────────────────────────────────────────────
  describe('isMembershipDowngraded', () => {
    it('从未开通过的门店不算降级，避免误伤全部免费商家', () => {
      expect(
        isMembershipDowngraded(
          {
            currentPlanId: null,
            previousPlanId: null,
            startsAt: null,
            expiresAt: null,
          },
          NOW,
        ),
      ).toBe(false);
    });

    it('已过 expiresAt 的门店算降级', () => {
      expect(
        isMembershipDowngraded(
          {
            currentPlanId: 'monthly',
            previousPlanId: null,
            startsAt: daysFromNow(-40),
            expiresAt: daysFromNow(-10),
          },
          NOW,
        ),
      ).toBe(true);
    });

    it('currentPlanId 被清空但 previousPlanId 仍在时仍算降级', () => {
      // 回归：运营「设为免费」会把 currentPlanId 清空，只留 previousPlanId。
      // 只认 currentPlanId 的版本会让这一步变成解除全部到期限制的绕过路径。
      expect(
        isMembershipDowngraded(
          {
            currentPlanId: null,
            previousPlanId: 'yearly',
            startsAt: daysFromNow(-400),
            expiresAt: daysFromNow(-10),
          },
          NOW,
        ),
      ).toBe(true);
    });

    it('到期时间算不出来时不按降级处理，避免拿脏数据掐断营业', () => {
      expect(
        isMembershipDowngraded(
          {
            currentPlanId: 'monthly',
            previousPlanId: null,
            startsAt: null,
            expiresAt: null,
          },
          NOW,
        ),
      ).toBe(false);
    });
  });
});
