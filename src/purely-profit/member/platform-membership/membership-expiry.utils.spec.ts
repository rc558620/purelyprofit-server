import { DAY_MS } from './platform-membership.constants';
import {
  calcRemainingDays,
  isMembershipProfileActive,
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
});
