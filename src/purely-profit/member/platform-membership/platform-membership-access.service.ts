import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';

export type MembershipRuntimeLevel =
  | 'free'
  | PlatformMembershipPlanId
  | 'lifetime';

type MembershipRuleConfig = {
  productLimit: number | null;
  employeeLimit: number | null;
  spaceLimit: number | null;
  historyDays: number | null;
  reportExportEnabled: boolean;
  financeEnabled: boolean;
  marketingEnabled: boolean;
  subAccountEligible: boolean;
};

type StoreMembershipProfileSnapshot = {
  currentPlanId: PlatformMembershipPlanId | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  subAccountQuota: number;
};

interface MembershipRuleSnapshot extends MembershipRuleConfig {
  level: MembershipRuntimeLevel;
}

export interface SubAccountBenefitSnapshot {
  level: MembershipRuntimeLevel;
  eligible: boolean;
  quota: number;
  quotaMax: number;
  enabled: boolean;
  rawQuota: number;
}

export interface SubAccountRoleSnapshot {
  role: StoreSubAccountRole;
  status: StoreSubAccountStatus;
  canAccessHome: boolean;
  canUseHandover: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SUB_ACCOUNT_QUOTA_MAX = 10;

const MEMBERSHIP_RULES: Record<MembershipRuntimeLevel, MembershipRuleConfig> = {
  free: {
    productLimit: 3,
    employeeLimit: 0,
    spaceLimit: 1,
    historyDays: 7,
    reportExportEnabled: false,
    financeEnabled: false,
    marketingEnabled: false,
    subAccountEligible: false,
  },
  monthly: {
    productLimit: 30,
    employeeLimit: 5,
    spaceLimit: 10,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
    subAccountEligible: false,
  },
  quarterly: {
    productLimit: 100,
    employeeLimit: 10,
    spaceLimit: 30,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
    subAccountEligible: false,
  },
  yearly: {
    productLimit: null,
    employeeLimit: null,
    spaceLimit: null,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
    subAccountEligible: true,
  },
  lifetime: {
    productLimit: null,
    employeeLimit: null,
    spaceLimit: null,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
    subAccountEligible: true,
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

  async ensureFinanceFeatureEnabled(
    storeId: number,
    callerIsSubAccount = false,
  ): Promise<void> {
    if (callerIsSubAccount) {
      return;
    }
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (!snapshot.financeEnabled) {
      throw new ForbiddenException(
        '当前会员套餐暂不支持财务管理，请升级会员后使用',
      );
    }
  }

  async ensureMarketingFeatureEnabled(
    storeId: number,
    callerIsSubAccount = false,
  ): Promise<void> {
    if (callerIsSubAccount) {
      return;
    }
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (!snapshot.marketingEnabled) {
      throw new ForbiddenException(
        '当前会员套餐暂不支持营销中心，请升级会员后使用',
      );
    }
  }

  async ensureReportExportEnabled(
    storeId: number,
    callerIsSubAccount = false,
  ): Promise<void> {
    if (callerIsSubAccount) {
      return;
    }
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (!snapshot.reportExportEnabled) {
      throw new ForbiddenException(
        '当前会员套餐暂不支持报表导出，请升级会员后使用',
      );
    }
  }

  async getHistoryWindowStart(
    storeId: number,
    callerIsSubAccount = false,
  ): Promise<number | null> {
    if (callerIsSubAccount) {
      return null;
    }
    const snapshot = await this.getStoreRuleSnapshot(storeId);
    if (snapshot.historyDays === null) {
      return null;
    }

    return this.getHistoryWindowStartFromDays(snapshot.historyDays);
  }

  async clampHistoryRange(
    storeId: number,
    range: { start: number; end: number },
    callerIsSubAccount = false,
  ): Promise<{
    start: number;
    end: number;
    clamped: boolean;
    empty: boolean;
  }> {
    const historyWindowStart = await this.getHistoryWindowStart(
      storeId,
      callerIsSubAccount,
    );
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

  async getSubAccountBenefitSnapshot(
    storeId: number,
  ): Promise<SubAccountBenefitSnapshot> {
    const profile = await this.loadStoreMembershipProfile(storeId);
    const level = this.resolveMembershipLevel(profile);
    const rule = MEMBERSHIP_RULES[level];
    const rawQuota = profile?.subAccountQuota ?? 0;
    const quota = this.normalizeSubAccountQuota(
      rawQuota,
      rule.subAccountEligible,
    );

    return {
      level,
      eligible: rule.subAccountEligible,
      quota,
      quotaMax: rule.subAccountEligible ? SUB_ACCOUNT_QUOTA_MAX : 0,
      enabled: quota > 0,
      rawQuota,
    };
  }

  async getSubAccountQuota(storeId: number): Promise<number> {
    const snapshot = await this.getSubAccountBenefitSnapshot(storeId);
    return snapshot.quota;
  }

  async isSubAccountFeatureEnabled(storeId: number): Promise<boolean> {
    const snapshot = await this.getSubAccountBenefitSnapshot(storeId);
    return snapshot.enabled;
  }

  async ensureSubAccountConfigurable(
    storeId: number,
    requestedQuota: number,
  ): Promise<void> {
    this.ensureValidSubAccountQuota(requestedQuota);
    const snapshot = await this.getSubAccountBenefitSnapshot(storeId);
    if (requestedQuota === 0) {
      return;
    }

    if (!snapshot.eligible) {
      throw new ForbiddenException(
        '当前会员等级暂不支持配置子账号，仅年会员或永久会员可开通',
      );
    }
  }

  async ensureSubAccountHandoverEnabled(storeId: number): Promise<void> {
    const snapshot = await this.getSubAccountBenefitSnapshot(storeId);
    if (!snapshot.enabled) {
      throw new ForbiddenException(
        '当前门店未启用子账号交班，请先配置子账号额度',
      );
    }
  }

  resolveSubAccountRoleSnapshot(
    role: StoreSubAccountRole,
    status: StoreSubAccountStatus,
    canAccessHome: boolean,
    canUseHandover: boolean,
  ): SubAccountRoleSnapshot {
    return {
      role,
      status,
      canAccessHome,
      canUseHandover,
    };
  }

  private async getStoreRuleSnapshot(
    storeId: number,
  ): Promise<MembershipRuleSnapshot> {
    const profile = await this.loadStoreMembershipProfile(storeId);
    const level = this.resolveMembershipLevel(profile);
    return {
      level,
      ...MEMBERSHIP_RULES[level],
    };
  }

  private async loadStoreMembershipProfile(
    storeId: number,
  ): Promise<StoreMembershipProfileSnapshot | null> {
    try {
      return await this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: {
          currentPlanId: true,
          startsAt: true,
          expiresAt: true,
          subAccountQuota: true,
        },
      });
    } catch (error: unknown) {
      if (!this.isMissingSubAccountQuotaSchemaError(error)) {
        throw error;
      }

      console.warn(
        '[membership-access] store_membership_profiles.sub_account_quota schema not ready, deny request to avoid stale membership capability fallback',
      );
      throw new UnauthorizedException(
        '会员能力上下文未就绪，请联系管理员完成系统升级后重试',
      );
    }
  }

  private isMissingSubAccountQuotaSchemaError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    if (
      !message.includes('sub_account_quota') &&
      !message.includes('subaccountquota')
    ) {
      return false;
    }

    return (
      message.includes('does not exist') ||
      message.includes("doesn't exist") ||
      message.includes('unknown column') ||
      message.includes('no such column') ||
      message.includes('unknown field') ||
      message.includes('column')
    );
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

  private normalizeSubAccountQuota(
    rawQuota: number,
    eligible: boolean,
  ): number {
    if (!eligible) {
      return 0;
    }

    if (!Number.isInteger(rawQuota)) {
      return 0;
    }

    return Math.min(Math.max(rawQuota, 0), SUB_ACCOUNT_QUOTA_MAX);
  }

  private ensureValidSubAccountQuota(quota: number): void {
    if (!Number.isInteger(quota)) {
      throw new ForbiddenException('子账号额度必须是整数');
    }

    if (quota < 0 || quota > SUB_ACCOUNT_QUOTA_MAX) {
      throw new ForbiddenException(
        `子账号额度必须在 0 到 ${SUB_ACCOUNT_QUOTA_MAX} 之间`,
      );
    }
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
