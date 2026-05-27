import { ForbiddenException, Injectable } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';

type MembershipRuntimeLevel = 'free' | PlatformMembershipPlanId | 'lifetime';

type MembershipRuleConfig = {
  productLimit: number | null;
  employeeLimit: number | null;
  spaceLimit: number | null;
  historyDays: number | null;
  reportExportEnabled: boolean;
  financeEnabled: boolean;
  marketingEnabled: boolean;
};

type StoreMembershipProfileSnapshot = {
  currentPlanId: PlatformMembershipPlanId | null;
  startsAt: Date | null;
  expiresAt: Date | null;
};

interface MembershipRuleSnapshot extends MembershipRuleConfig {
  level: MembershipRuntimeLevel;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const MEMBERSHIP_RULES: Record<MembershipRuntimeLevel, MembershipRuleConfig> = {
  free: {
    productLimit: 3,
    employeeLimit: 0,
    spaceLimit: 1,
    historyDays: 7,
    reportExportEnabled: false,
    financeEnabled: false,
    marketingEnabled: false,
  },
  monthly: {
    productLimit: 30,
    employeeLimit: 5,
    spaceLimit: 10,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
  },
  quarterly: {
    productLimit: 100,
    employeeLimit: 10,
    spaceLimit: 30,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
  },
  yearly: {
    productLimit: null,
    employeeLimit: null,
    spaceLimit: null,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
  },
  lifetime: {
    productLimit: null,
    employeeLimit: null,
    spaceLimit: null,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
  },
};

@Injectable()
export class PlatformMembershipAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureProductQuotaAvailable(storeId: number): Promise<void> {
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (snapshot.productLimit === null) {
      return;
    }

    const currentCount = await this.prisma.product.count({
      where: { storeId },
    });
    if (currentCount >= snapshot.productLimit) {
      throw new ForbiddenException(
        `当前会员套餐最多可录入 ${snapshot.productLimit} 个商品，请升级会员后继续添加`,
      );
    }
  }

  async ensureEmployeeQuotaAvailable(storeId: number): Promise<void> {
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (snapshot.employeeLimit === null) {
      return;
    }

    const currentCount = await this.prisma.employee.count({
      where: {
        storeId,
        status: EmployeeStatus.active,
      },
    });
    if (currentCount >= snapshot.employeeLimit) {
      throw new ForbiddenException(
        `当前会员套餐最多可管理 ${snapshot.employeeLimit} 名在职员工，请升级会员后继续添加`,
      );
    }
  }

  async ensureSpaceQuotaAvailable(storeId: number): Promise<void> {
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (snapshot.spaceLimit === null) {
      return;
    }

    const currentCount = await this.prisma.space.count({
      where: { storeId },
    });
    if (currentCount >= snapshot.spaceLimit) {
      throw new ForbiddenException(
        `当前会员套餐最多可创建 ${snapshot.spaceLimit} 个空间，请升级会员后继续添加`,
      );
    }
  }

  async ensureFinanceFeatureEnabled(storeId: number): Promise<void> {
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (!snapshot.financeEnabled) {
      throw new ForbiddenException(
        '当前会员套餐暂不支持财务管理，请升级会员后使用',
      );
    }
  }

  async ensureMarketingFeatureEnabled(storeId: number): Promise<void> {
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (!snapshot.marketingEnabled) {
      throw new ForbiddenException(
        '当前会员套餐暂不支持营销中心，请升级会员后使用',
      );
    }
  }

  async ensureReportExportEnabled(storeId: number): Promise<void> {
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (!snapshot.reportExportEnabled) {
      throw new ForbiddenException(
        '当前会员套餐暂不支持报表导出，请升级会员后使用',
      );
    }
  }

  async getHistoryWindowStart(storeId: number): Promise<number | null> {
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (snapshot.historyDays === null) {
      return null;
    }

    return this.getHistoryWindowStartFromDays(snapshot.historyDays);
  }

  async clampHistoryRange(
    storeId: number,
    range: { start: number; end: number },
  ): Promise<{
    start: number;
    end: number;
    clamped: boolean;
    empty: boolean;
  }> {
    const historyWindowStart = await this.getHistoryWindowStart(storeId);
    if (historyWindowStart === null) {
      return {
        start: range.start,
        end: range.end,
        clamped: false,
        empty: range.end < range.start,
      };
    }

    if (range.end < historyWindowStart) {
      return {
        start: historyWindowStart,
        end: historyWindowStart - 1,
        clamped: true,
        empty: true,
      };
    }

    return {
      start: Math.max(range.start, historyWindowStart),
      end: range.end,
      clamped: range.start < historyWindowStart,
      empty: false,
    };
  }

  private async getStoreRuleSnapshot(
    storeId: number,
  ): Promise<MembershipRuleSnapshot> {
    const profile = await this.prisma.storeMembershipProfile.findUnique({
      where: { storeId },
      select: {
        currentPlanId: true,
        startsAt: true,
        expiresAt: true,
      },
    });

    const level = this.resolveMembershipLevel(profile);
    return {
      level,
      ...MEMBERSHIP_RULES[level],
    };
  }

  private resolveMembershipLevel(
    profile: StoreMembershipProfileSnapshot | null,
  ): MembershipRuntimeLevel {
    if (!profile?.currentPlanId) {
      return 'free';
    }

    if (profile.currentPlanId === 'yearly' && profile.expiresAt === null) {
      return 'lifetime';
    }

    const expiresAt = this.resolveMembershipExpiry(profile);
    if (profile.currentPlanId === 'lifetime' && expiresAt === null) {
      return 'lifetime';
    }

    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      return 'free';
    }

    return profile.currentPlanId;
  }

  private resolveMembershipExpiry(
    profile: StoreMembershipProfileSnapshot,
  ): Date | null {
    if (profile.expiresAt) {
      return profile.expiresAt;
    }

    if (profile.currentPlanId === 'yearly') {
      const baseTime = profile.startsAt?.getTime() ?? Date.now();
      return new Date(baseTime + 730 * DAY_MS);
    }

    return null;
  }

  private getHistoryWindowStartFromDays(days: number): number {
    const now = new Date();
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - days + 1,
      0,
      0,
      0,
      0,
    ).getTime();
  }
}
