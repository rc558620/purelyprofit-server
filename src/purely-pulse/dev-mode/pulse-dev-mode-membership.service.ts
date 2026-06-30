import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PlatformMembershipPartnerProfileResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import {
  DEV_EXPIRES_AT,
  DEV_PLAN_ID,
  getDevRemainingDays,
} from './pulse-dev-mode.constants';

@Injectable()
export class PulseDevModeMembershipService {
  buildMembershipProfile(
    user: AuthenticatedUser,
  ): PlatformMembershipProfileResponseDto {
    return {
      memberInfo: this.buildDeveloperMemberInfo(user),
      approvedPartner: null,
      approvedPartners: [],
    };
  }

  buildMembershipCenter(
    user: AuthenticatedUser,
  ): PlatformMembershipCenterResponseDto {
    return {
      memberInfo: this.buildDeveloperMemberInfo(user),
      remainingDays: getDevRemainingDays(),
      stats: {
        partnerCount: 0,
        totalPromos: 0,
        chargedPromos: 0,
      },
      paidOrderCount: 0,
      myPartnerApplication: null,
      approvedPartner: null,
      approvedPartners: [],
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
      approvedPartners: [],
      overview: {
        beanBalance: 0,
        totalEarnedBeans: 0,
  totalWithdrawnBeans: 0,
  pendingBeans: 0,
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
      approvedPartners: [],
      level: {
        partnerLevel: null,
        monthChargedCount: 0,
        monthCountToNextLevel: null,
        currentLevelRewards: { monthly: 0, quarterly: 0, yearly: 0 },
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
      approvedPartners: [],
      level: {
        partnerLevel: null,
        monthChargedCount: 0,
        monthCountToNextLevel: null,
        currentLevelRewards: { monthly: 0, quarterly: 0, yearly: 0 },
      },
    };
  }

  private buildDeveloperMemberInfo(user: AuthenticatedUser) {
    return {
      isActive: true,
      planId: DEV_PLAN_ID,
      expiredAt: DEV_EXPIRES_AT.getTime(),
      inviteCode: `DEV${user.id}`,
      totalPoints: 0,
      availablePoints: 0,
    };
  }
}
