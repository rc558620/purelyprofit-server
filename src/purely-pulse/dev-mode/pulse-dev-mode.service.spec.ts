import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PulseDevModeAccessService } from './pulse-dev-mode-access.service';
import { PulseDevModeDashboardService } from './pulse-dev-mode-dashboard.service';
import { PulseDevModeGrowthService } from './pulse-dev-mode-growth.service';
import { PulseDevModeMembershipService } from './pulse-dev-mode-membership.service';
import { PulseDevModeSessionService } from './pulse-dev-mode-session.service';
import { PulseDevModeService } from './pulse-dev-mode.service';
import {
  DEV_EXPIRES_AT,
  DEV_MODE_NAME,
  DEV_PLAN_ID,
  getDevRemainingDays,
} from './pulse-dev-mode.constants';

describe('PulseDevModeService', () => {
  const service = new PulseDevModeService(
    new PulseDevModeAccessService(),
    new PulseDevModeSessionService(),
    new PulseDevModeDashboardService(),
    new PulseDevModeMembershipService(),
    new PulseDevModeGrowthService(),
  );

  const user: AuthenticatedUser = {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    pulseMode: 'developer',
    isPulseDeveloper: true,
    currentMembership: null,
  };

  // ── Access ──────────────────────────────────────────────

  describe('isEnabled', () => {
    it('识别开发者账号', () => {
      expect(service.isEnabled(user)).toBe(true);
    });

    it('普通用户返回 false', () => {
      expect(
        service.isEnabled({
          ...user,
          pulseMode: 'normal',
          isPulseDeveloper: false,
        }),
      ).toBe(false);
    });

    it('仅 pulseMode 为 developer 即可', () => {
      expect(service.isEnabled({ ...user, isPulseDeveloper: false })).toBe(
        true,
      );
    });

    it('仅 isPulseDeveloper 为 true 即可', () => {
      expect(service.isEnabled({ ...user, pulseMode: 'normal' })).toBe(true);
    });
  });

  describe('throwUnsupported', () => {
    it('抛出禁止操作异常', () => {
      expect(() => service.throwUnsupported('禁止代目标商家操作')).toThrow(
        ForbiddenException,
      );
    });

    it('异常信息透传', () => {
      expect(() => service.throwUnsupported('自定义消息')).toThrow(
        '自定义消息',
      );
    });
  });

  // ── Session ─────────────────────────────────────────────

  describe('buildSessionBootstrap', () => {
    const result = service.buildSessionBootstrap({
      id: 101,
      phone: '13800138000',
      name: '开发者',
      avatar: '',
      verified: true,
    });

    it('返回开发者模式', () => {
      expect(result.mode).toBe('developer');
    });

    it('store 为 null', () => {
      expect(result.store).toBeNull();
    });

    it('membership 使用 DEV_PLAN_ID', () => {
      expect(result.membership.planId).toBe(DEV_PLAN_ID);
    });

    it('membership.planName 为开发者模式', () => {
      expect(result.membership.planName).toBe(DEV_MODE_NAME);
    });

    it('membership.isActive 为 true', () => {
      expect(result.membership.isActive).toBe(true);
    });

    it('membership.remainingDays 动态计算', () => {
      expect(result.membership.remainingDays).toBe(getDevRemainingDays());
      expect(result.membership.remainingDays).toBeGreaterThan(0);
    });

    it('membership.expiresAt 使用 DEV_EXPIRES_AT', () => {
      expect(result.membership.expiresAt).toBe(DEV_EXPIRES_AT);
    });

    it('unreadNotificationCount 为 0', () => {
      expect(result.unreadNotificationCount).toBe(0);
    });

    it('targetStoreSelected 为 false', () => {
      expect(result.targetStoreSelected).toBe(false);
    });

    it('hasOnboarded 为 false（与 targetStoreSelected 一致）', () => {
      expect(result.hasOnboarded).toBe(false);
    });
  });

  describe('buildOnboardingStatus', () => {
    const result = service.buildOnboardingStatus();

    it('isCompleted 为 true', () => {
      expect(result.isCompleted).toBe(true);
    });

    it('steps 全部为 true', () => {
      expect(result.steps).toEqual({
        hasRegistered: true,
        hasVerifiedRealName: true,
        hasCreatedStore: true,
        hasMembership: true,
      });
    });

    it('targetStatus.storeSelected 为 false', () => {
      expect(result.targetStatus.storeSelected).toBe(false);
    });

    it('targetStatus.membershipActive 为 true', () => {
      expect(result.targetStatus.membershipActive).toBe(true);
    });

    it('storeId 为 null', () => {
      expect(result.storeId).toBeNull();
    });

    it('storeName 为开发者模式', () => {
      expect(result.storeName).toBe(DEV_MODE_NAME);
    });
  });

  // ── Dashboard ───────────────────────────────────────────

  describe('buildDashboardOverview', () => {
    it('today 周期返回正确结构', () => {
      const result = service.buildDashboardOverview('today');
      expect(result.stats.profit).toBe(0);
      expect(result.stats.profitChange).toBeNull();
      expect(result.stats.orderCount).toBe(0);
      expect(result.stats.orderChange).toBeNull();
      expect(result.stats.revenue).toBe(0);
      expect(result.stats.totalCost).toBe(0);
      expect(result.salesTrend.categories).toEqual([]);
      expect(result.salesTrend.actual).toEqual([]);
      expect(result.salesTrend.isYearMode).toBe(false);
      expect(result.meta.period).toBe('today');
      expect(result.meta.storeId).toBeNull();
      expect(result.meta.storeCount).toBe(0);
    });

    it('year 周期 isYearMode 为 true', () => {
      const result = service.buildDashboardOverview('year');
      expect(result.salesTrend.isYearMode).toBe(true);
    });
  });

  describe('buildDashboardStores', () => {
    it('返回空门店列表与正确 meta', () => {
      const result = service.buildDashboardStores('month');
      expect(result.stores).toEqual([]);
      expect(result.meta.period).toBe('month');
      expect(result.meta.storeId).toBeNull();
      expect(result.meta.storeCount).toBe(0);
    });
  });

  describe('buildDashboardAnalysis', () => {
    it('返回全零经营分析结构', () => {
      const result = service.buildDashboardAnalysis();
      expect(result.heroSummary.netProfit.current).toBe(0);
      expect(result.heroSummary.netProfit.changeRate).toBeNull();
      expect(result.dailyTrend).toEqual([]);
      expect(result.categoryShares).toEqual([]);
      expect(result.costRateItems).toEqual([]);
      expect(result.rankProducts).toEqual([]);
    });
  });

  // ── Membership ──────────────────────────────────────────

  describe('buildMembershipProfile', () => {
    const result = service.buildMembershipProfile(user);

    it('memberInfo.planId 使用 DEV_PLAN_ID', () => {
      expect(result.memberInfo.planId).toBe(DEV_PLAN_ID);
    });

    it('memberInfo.isActive 为 true', () => {
      expect(result.memberInfo.isActive).toBe(true);
    });

    it('approvedPartner 为 null', () => {
      expect(result.approvedPartner).toBeNull();
    });

    it('approvedPartners 为空数组', () => {
      expect(result.approvedPartners).toEqual([]);
    });
  });

  describe('buildMembershipCenter', () => {
    const result = service.buildMembershipCenter(user);

    it('memberInfo.planId 使用 DEV_PLAN_ID', () => {
      expect(result.memberInfo.planId).toBe(DEV_PLAN_ID);
    });

    it('remainingDays 动态计算', () => {
      expect(result.remainingDays).toBe(getDevRemainingDays());
    });

    it('paidOrderCount 为 0', () => {
      expect(result.paidOrderCount).toBe(0);
    });

    it('approvedPartner 为 null', () => {
      expect(result.approvedPartner).toBeNull();
    });
  });

  describe('buildMembershipOrders', () => {
    const result = service.buildMembershipOrders();

    it('overview 订单数与金额为 0', () => {
      expect(result.overview.orderCount).toBe(0);
      expect(result.overview.totalAmount).toBe(0);
    });

    it('items 为空数组', () => {
      expect(result.items).toEqual([]);
    });
  });

  describe('buildMembershipPointsLogs', () => {
    const result = service.buildMembershipPointsLogs(user);

    it('memberInfo.planId 使用 DEV_PLAN_ID', () => {
      expect(result.memberInfo.planId).toBe(DEV_PLAN_ID);
    });

    it('overview 积分全部为 0', () => {
      expect(result.overview.availablePoints).toBe(0);
      expect(result.overview.totalEarned).toBe(0);
      expect(result.overview.totalSpent).toBe(0);
    });

    it('items 为空数组', () => {
      expect(result.items).toEqual([]);
    });
  });

  describe('buildMembershipBeanLogs', () => {
    const result = service.buildMembershipBeanLogs();

    it('overview 纯利豆全部为 0', () => {
expect(result.overview.beanBalance).toBe(0);
expect(result.overview.totalEarnedBeans).toBe(0);
expect(result.overview.totalWithdrawnBeans).toBe(0);
expect(result.overview.pendingBeans).toBe(0);
    });

    it('approvedPartner 为 null', () => {
      expect(result.approvedPartner).toBeNull();
    });
  });

  describe('buildPromoCenter', () => {
    const result = service.buildPromoCenter(user);

    it('memberInfo.planId 使用 DEV_PLAN_ID', () => {
      expect(result.memberInfo.planId).toBe(DEV_PLAN_ID);
    });

    it('stats 全部为 0', () => {
      expect(result.stats.totalPromos).toBe(0);
      expect(result.stats.chargedPromos).toBe(0);
      expect(result.stats.promoRate).toBe(0);
      expect(result.stats.earnedBeans).toBe(0);
    });

    it('statsByPeriod 包含 all/today/month/year 四个维度', () => {
      expect(Object.keys(result.statsByPeriod)).toEqual([
        'all',
        'today',
        'month',
        'year',
      ]);
    });

    it('level.partnerLevel 为 null', () => {
      expect(result.level.partnerLevel).toBeNull();
    });
  });

  describe('buildPartnerProfile', () => {
    const result = service.buildPartnerProfile();

    it('isPartner 为 false', () => {
      expect(result.isPartner).toBe(false);
    });

    it('currentApplication 为 null', () => {
      expect(result.currentApplication).toBeNull();
    });

    it('applications 为空数组', () => {
      expect(result.applications).toEqual([]);
    });
  });

  // ── Growth ──────────────────────────────────────────────

  describe('buildEarningsOverview', () => {
    const result = service.buildEarningsOverview();

    it('isPartner 为 false', () => {
      expect(result.isPartner).toBe(false);
    });

    it('beanBalance 为 0', () => {
      expect(result.beanBalance).toBe(0);
    });

    it('approvedPartner 为 null', () => {
      expect(result.approvedPartner).toBeNull();
    });

    it('pendingWithdrawals 为 0', () => {
      expect(result.pendingWithdrawals).toBe(0);
    });
  });

  describe('buildEarningsLogs', () => {
    const result = service.buildEarningsLogs();

    it('items 为空数组', () => {
      expect(result.items).toEqual([]);
    });

    it('hasMore 为 false', () => {
      expect(result.hasMore).toBe(false);
    });

    it('nextCursor 为 null', () => {
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('buildWithdrawalAccount', () => {
    const result = service.buildWithdrawalAccount();

    it('isPartner 为 false', () => {
      expect(result.isPartner).toBe(false);
    });

    it('selectedPartner 为 null', () => {
      expect(result.selectedPartner).toBeNull();
    });

    it('accountType 为 null', () => {
      expect(result.accountType).toBeNull();
    });

    it('beanBalance 为 0', () => {
      expect(result.beanBalance).toBe(0);
    });
  });
});

// ── AccessService 静态方法 ────────────────────────────────

describe('PulseDevModeAccessService.isDeveloper (static)', () => {
  const baseUser: AuthenticatedUser = {
    id: 1,
    email: 'test@example.com',
    phone: '13800000000',
    name: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    pulseMode: undefined,
    isPulseDeveloper: undefined,
    currentMembership: null,
  };

  it('pulseMode 为 developer 时返回 true', () => {
    expect(
      PulseDevModeAccessService.isDeveloper({
        ...baseUser,
        pulseMode: 'developer',
      }),
    ).toBe(true);
  });

  it('isPulseDeveloper 为 true 时返回 true', () => {
    expect(
      PulseDevModeAccessService.isDeveloper({
        ...baseUser,
        isPulseDeveloper: true,
      }),
    ).toBe(true);
  });

  it('两者都为 false/undefined 时返回 false', () => {
    expect(PulseDevModeAccessService.isDeveloper(baseUser)).toBe(false);
  });
});

// ── Constants ─────────────────────────────────────────────

describe('getDevRemainingDays', () => {
  it('返回正数', () => {
    expect(getDevRemainingDays()).toBeGreaterThan(0);
  });

  it('返回值在合理范围（当前到 2099 年）', () => {
    const days = getDevRemainingDays();
    expect(days).toBeGreaterThan(25_000);
    expect(days).toBeLessThan(30_000);
  });
});
