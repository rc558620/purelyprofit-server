import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { BusinessAnalysisResponseDto } from '../../purely-profit/dashboard/business-analysis/dto/business-analysis-response.dto';
import type {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PlatformMembershipPartnerProfileResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import type { OnboardingStatusResponseDto } from '../onboarding/dto/onboarding-status.dto';
import { buildCurrentRange } from '../dashboard/dashboard-time.utils';
import type { PulseDashboardPeriodValue } from '../dashboard/dto/pulse-dashboard-query.dto';
import type {
  PulseDashboardOverviewResponseDto,
  PulseDashboardStoresResponseDto,
} from '../dashboard/dto/pulse-dashboard-response.dto';
import type {
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountResponseDto,
} from '../growth/dto/pulse-growth.dto';
import type {
  PulseSessionBootstrapResponseDto,
  PulseSessionUserDto,
} from '../session/dto/session-bootstrap.dto';

const DEV_EXPIRES_AT = new Date('2099-12-31T23:59:59.999Z');
const DEV_REMAINING_DAYS = 36_500;

const PERIOD_ORDER_LABEL: Record<PulseDashboardPeriodValue, string> = {
  today: '今日订单数',
  week: '本周订单数',
  month: '本月订单数',
  year: '今年订单数',
};

const PERIOD_PROFIT_LABEL: Record<PulseDashboardPeriodValue, string> = {
  today: '今日净利润 (元)',
  week: '本周净利润 (元)',
  month: '本月净利润 (元)',
  year: '今年净利润 (元)',
};

@Injectable()
export class PulseDevModeService {
  isEnabled(user: AuthenticatedUser): boolean {
    return user.pulseMode === 'developer' || user.isPulseDeveloper === true;
  }

  throwUnsupported(message: string): never {
    throw new ForbiddenException(message);
  }

  buildSessionBootstrap(
    sessionUser: PulseSessionUserDto,
  ): PulseSessionBootstrapResponseDto {
    return {
      mode: 'developer',
      user: sessionUser,
      store: null,
      membership: {
        isActive: true,
        planId: 'developer',
        planName: '开发者模式',
        remainingDays: DEV_REMAINING_DAYS,
        expiresAt: DEV_EXPIRES_AT,
      },
      unreadNotificationCount: 0,
      targetStoreSelected: false,
      hasOnboarded: true,
    };
  }

  buildOnboardingStatus(): OnboardingStatusResponseDto {
    return {
      isCompleted: true,
      steps: {
        hasRegistered: true,
        hasVerifiedRealName: true,
        hasCreatedStore: true,
        hasMembership: true,
      },
      targetStatus: {
        isReady: true,
        storeSelected: false,
        merchantVerified: true,
        membershipActive: true,
        storeId: null,
        storeName: '开发者模式',
      },
      storeId: null,
      storeName: '开发者模式',
    };
  }

  buildDashboardOverview(
    period: PulseDashboardPeriodValue,
  ): PulseDashboardOverviewResponseDto {
    const currentRange = buildCurrentRange(period);

    return {
      stats: {
        profitLabel: PERIOD_PROFIT_LABEL[period],
        profit: 0,
        profitChange: null,
        orderLabel: PERIOD_ORDER_LABEL[period],
        orderCount: 0,
        orderChange: null,
        revenue: 0,
        totalCost: 0,
      },
      salesTrend: {
        categories: [],
        actual: [],
        isYearMode: period === 'year',
      },
      meta: {
        period,
        storeId: null,
        storeCount: 0,
        startAt: currentRange.start,
        endAt: currentRange.end,
        generatedAt: Date.now(),
      },
    };
  }

  buildDashboardStores(
    period: PulseDashboardPeriodValue,
  ): PulseDashboardStoresResponseDto {
    const currentRange = buildCurrentRange(period);

    return {
      meta: {
        period,
        storeId: null,
        storeCount: 0,
        startAt: currentRange.start,
        endAt: currentRange.end,
        generatedAt: Date.now(),
      },
      stores: [],
    };
  }

  buildDashboardAnalysis(): BusinessAnalysisResponseDto {
    return {
      heroSummary: {
        netProfit: { current: 0, previous: 0, changeRate: null },
        revenue: { current: 0, previous: 0, changeRate: null },
        totalCost: { current: 0, previous: 0, changeRate: null },
        profitRate: { current: 0, previous: 0, changeRate: null },
        orderCount: 0,
      },
      dailyTrend: [],
      categoryShares: [],
      costRateItems: [],
      rankProducts: [],
    };
  }

  buildMembershipProfile(
    user: AuthenticatedUser,
  ): PlatformMembershipProfileResponseDto {
    return {
      memberInfo: this.buildDeveloperMemberInfo(user),
      approvedPartner: null,
    };
  }

  buildMembershipCenter(
    user: AuthenticatedUser,
  ): PlatformMembershipCenterResponseDto {
    return {
      memberInfo: this.buildDeveloperMemberInfo(user),
      remainingDays: DEV_REMAINING_DAYS,
      stats: {
        totalPromos: 0,
        chargedPromos: 0,
      },
      paidOrderCount: 0,
      myPartnerApplication: null,
      approvedPartner: null,
    };
  }

  buildMembershipOrders(): PlatformMembershipOrdersResponseDto {
    return {
      overview: {
        orderCount: 0,
        totalAmount: 0,
      },
      items: [],
    };
  }

  buildMembershipPointsLogs(
    user: AuthenticatedUser,
  ): PlatformMembershipPointsLogsResponseDto {
    return {
      memberInfo: this.buildDeveloperMemberInfo(user),
      overview: {
        availablePoints: 0,
        totalEarned: 0,
        totalSpent: 0,
      },
      items: [],
    };
  }

  buildMembershipBeanLogs(): PlatformMembershipBeanLogsResponseDto {
    return {
      approvedPartner: null,
      overview: {
        beanBalance: 0,
        totalEarnedBeans: 0,
        totalWithdrawnBeans: 0,
      },
      items: [],
    };
  }

  buildPromoCenter(
    user: AuthenticatedUser,
  ): PlatformMembershipPromoCenterResponseDto {
    const emptyStats = {
      totalPromos: 0,
      chargedPromos: 0,
      promoRate: 0,
      earnedBeans: 0,
    };

    return {
      memberInfo: this.buildDeveloperMemberInfo(user),
      approvedPartner: null,
      level: {
        partnerLevel: null,
        monthChargedCount: 0,
        monthCountToNextLevel: null,
      },
      stats: emptyStats,
      statsByPeriod: {
        all: { ...emptyStats },
        today: { ...emptyStats },
        month: { ...emptyStats },
        year: { ...emptyStats },
      },
      items: [],
    };
  }

  buildPartnerProfile(): PlatformMembershipPartnerProfileResponseDto {
    return {
      isPartner: false,
      currentApplication: null,
      applications: [],
      approvedPartner: null,
      level: {
        partnerLevel: null,
        monthChargedCount: 0,
        monthCountToNextLevel: null,
      },
    };
  }

  buildEarningsOverview(): PulseEarningsOverviewResponseDto {
    return {
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
      totalPromos: 0,
      chargedPromos: 0,
      isPartner: false,
      pendingWithdrawals: 0,
    };
  }

  buildEarningsLogs(): PulseEarningsLogsResponseDto {
    return {
      items: [],
      beanBalance: 0,
    };
  }

  buildWithdrawalAccount(): PulseWithdrawalAccountResponseDto {
    return {
      isPartner: false,
      accountType: null,
      accountNo: null,
      accountName: null,
      beanBalance: 0,
    };
  }

  private buildDeveloperMemberInfo(user: AuthenticatedUser) {
    return {
      isActive: true,
      planId: 'yearly' as const,
      expiredAt: DEV_EXPIRES_AT.getTime(),
      inviteCode: `DEV${user.id}`,
      totalPoints: 0,
      availablePoints: 0,
    };
  }
}
