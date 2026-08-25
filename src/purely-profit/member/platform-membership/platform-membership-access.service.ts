import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildEmployeeQuotaExceededMessage,
  buildProductQuotaExceededMessage,
  buildSpaceQuotaExceededMessage,
  buildSubAccountQuotaOutOfRangeMessage,
  MEMBERSHIP_ACCESS_MESSAGES,
} from './platform-membership-access.messages';
import {
  buildMembershipRuleSnapshot,
  buildSubAccountBenefitSnapshot,
  clampHistoryRangeByWindow,
  createSubAccountRoleSnapshot,
  getHistoryWindowStartFromDays,
  getSubAccountQuotaValidationIssue,
  isMissingSubAccountQuotaSchemaError,
  type ClampedHistoryRange,
  type HistoryRange,
  type MembershipRuleSnapshot,
  type StoreMembershipProfileSnapshot,
  type SubAccountBenefitSnapshot,
  type SubAccountRoleSnapshot,
} from './platform-membership-access.shared';

export type { MembershipRuntimeLevel } from './platform-membership-access.shared';
export type {
  SubAccountBenefitSnapshot,
  SubAccountRoleSnapshot,
} from './platform-membership-access.shared';

type MembershipRuleLimitResolver = (
  snapshot: MembershipRuleSnapshot,
) => number | null;

type MembershipRuleFeatureResolver = (
  snapshot: MembershipRuleSnapshot,
) => boolean;

type CountQuotaErrorMessageBuilder = (limit: number) => string;

type EnsureCountQuotaAvailableParams = {
  storeId: number;
  getLimit: MembershipRuleLimitResolver;
  getCurrentCount: () => Promise<number>;
  buildErrorMessage: CountQuotaErrorMessageBuilder;
};

type EnsureFeatureEnabledParams = {
  storeId: number;
  callerIsSubAccount: boolean;
  isEnabled: MembershipRuleFeatureResolver;
  errorMessage: string;
};

@Injectable()
export class PlatformMembershipAccessService {
  private readonly logger = new Logger(PlatformMembershipAccessService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureProductQuotaAvailable(storeId: number): Promise<void> {
    await this.ensureCountQuotaAvailable({
      storeId,
      getLimit: (snapshot) => snapshot.productLimit,
      getCurrentCount: () =>
        this.prisma.product.count({
          where: { storeId, deletedAt: null },
        }),
      buildErrorMessage: buildProductQuotaExceededMessage,
    });
  }

  async ensureEmployeeQuotaAvailable(storeId: number): Promise<void> {
    await this.ensureCountQuotaAvailable({
      storeId,
      getLimit: (snapshot) => snapshot.employeeLimit,
      getCurrentCount: () =>
        this.prisma.employee.count({
          where: {
            storeId,
            deletedAt: null,
            status: EmployeeStatus.active,
          },
        }),
      buildErrorMessage: buildEmployeeQuotaExceededMessage,
    });
  }

  async ensureSpaceQuotaAvailable(storeId: number): Promise<void> {
    await this.ensureCountQuotaAvailable({
      storeId,
      getLimit: (snapshot) => snapshot.spaceLimit,
      getCurrentCount: () =>
        this.prisma.space.count({
          where: { storeId, deletedAt: null },
        }),
      buildErrorMessage: buildSpaceQuotaExceededMessage,
    });
  }

  async ensureFinanceFeatureEnabled(
    storeId: number,
    callerIsSubAccount = false,
  ): Promise<void> {
    await this.ensureFeatureEnabled({
      storeId,
      callerIsSubAccount,
      isEnabled: (snapshot) => snapshot.financeEnabled,
      errorMessage: MEMBERSHIP_ACCESS_MESSAGES.financeDisabled,
    });
  }

  async ensureMarketingFeatureEnabled(
    storeId: number,
    callerIsSubAccount = false,
  ): Promise<void> {
    await this.ensureFeatureEnabled({
      storeId,
      callerIsSubAccount,
      isEnabled: (snapshot) => snapshot.marketingEnabled,
      errorMessage: MEMBERSHIP_ACCESS_MESSAGES.marketingDisabled,
    });
  }

  async ensureReportExportEnabled(
    storeId: number,
    callerIsSubAccount = false,
  ): Promise<void> {
    await this.ensureFeatureEnabled({
      storeId,
      callerIsSubAccount,
      isEnabled: (snapshot) => snapshot.reportExportEnabled,
      errorMessage: MEMBERSHIP_ACCESS_MESSAGES.reportExportDisabled,
    });
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

    return getHistoryWindowStartFromDays(snapshot.historyDays);
  }

  async clampHistoryRange(
    storeId: number,
    range: HistoryRange,
    callerIsSubAccount = false,
  ): Promise<ClampedHistoryRange> {
    const historyWindowStart = await this.getHistoryWindowStart(
      storeId,
      callerIsSubAccount,
    );
    return clampHistoryRangeByWindow(range, historyWindowStart);
  }

  async getSubAccountBenefitSnapshot(
    storeId: number,
  ): Promise<SubAccountBenefitSnapshot> {
    const profile = await this.loadStoreMembershipProfile(storeId);
    const pulseQuota = await this.safeLoadPulseSubAccountQuota(storeId);
    return buildSubAccountBenefitSnapshot(
      profile ? { ...profile, pulseSubAccountQuota: pulseQuota } : null,
    );
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
    this.assertValidSubAccountQuota(requestedQuota);
    const snapshot = await this.getSubAccountBenefitSnapshot(storeId);
    if (requestedQuota === 0) {
      return;
    }

    if (!snapshot.eligible) {
      throw new ForbiddenException(
        MEMBERSHIP_ACCESS_MESSAGES.subAccountNotEligible,
      );
    }
  }

  async ensureSubAccountHandoverEnabled(storeId: number): Promise<void> {
    const snapshot = await this.getSubAccountBenefitSnapshot(storeId);
    if (!snapshot.enabled) {
      throw new ForbiddenException(
        MEMBERSHIP_ACCESS_MESSAGES.subAccountHandoverDisabled,
      );
    }
  }

  resolveSubAccountRoleSnapshot(
    role: StoreSubAccountRole,
    status: StoreSubAccountStatus,
    canAccessHome: boolean,
    canUseHandover: boolean,
  ): SubAccountRoleSnapshot {
    return createSubAccountRoleSnapshot(
      role,
      status,
      canAccessHome,
      canUseHandover,
    );
  }

  private assertValidSubAccountQuota(quota: number): void {
    const validationIssue = getSubAccountQuotaValidationIssue(quota);
    if (validationIssue === 'not_integer') {
      throw new ForbiddenException(
        MEMBERSHIP_ACCESS_MESSAGES.subAccountQuotaMustBeInteger,
      );
    }

    if (validationIssue === 'out_of_range') {
      throw new ForbiddenException(buildSubAccountQuotaOutOfRangeMessage());
    }
  }

  private async ensureCountQuotaAvailable(
    params: EnsureCountQuotaAvailableParams,
  ): Promise<void> {
    const snapshot = await this.getStoreRuleSnapshot(params.storeId);
    const limit = params.getLimit(snapshot);
    if (limit === null) {
      return;
    }

    const currentCount = await params.getCurrentCount();
    if (currentCount >= limit) {
      throw new ForbiddenException(params.buildErrorMessage(limit));
    }
  }

  private async ensureFeatureEnabled(
    params: EnsureFeatureEnabledParams,
  ): Promise<void> {
    if (params.callerIsSubAccount) {
      return;
    }

    const snapshot = await this.getStoreRuleSnapshot(params.storeId);
    if (!params.isEnabled(snapshot)) {
      throw new ForbiddenException(params.errorMessage);
    }
  }

  private async getStoreRuleSnapshot(
    storeId: number,
  ): Promise<MembershipRuleSnapshot> {
    const profile = await this.loadStoreMembershipProfile(storeId);
    return buildMembershipRuleSnapshot(profile);
  }

  private async loadStoreMembershipProfile(
    storeId: number,
  ): Promise<StoreMembershipProfileSnapshot | null> {
    const normalizedStoreId = Number(storeId);
    if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) {
      throw new UnauthorizedException(
        MEMBERSHIP_ACCESS_MESSAGES.membershipContextNotReady,
      );
    }

    try {
      return await this.prisma.storeMembershipProfile.findUnique({
        where: { storeId: normalizedStoreId },
        select: {
          currentPlanId: true,
          startsAt: true,
          expiresAt: true,
          subAccountQuota: true,
        },
      });
    } catch (error: unknown) {
      if (!isMissingSubAccountQuotaSchemaError(error)) {
        throw error;
      }

      this.logger.warn(
        MEMBERSHIP_ACCESS_MESSAGES.membershipContextNotReadyWarning,
      );
      throw new UnauthorizedException(
        MEMBERSHIP_ACCESS_MESSAGES.membershipContextNotReady,
      );
    }
  }

  /**
   * 安全读取 pulse_sub_account_quota，迁移未执行时优雅降级为 0。
   * 该方法仅用于子账号功能路径，不影响认证/能力检查等关键链路。
   */
  private async safeLoadPulseSubAccountQuota(
    storeId: number,
  ): Promise<number | null> {
    try {
      const row = await this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: { pulseSubAccountQuota: true },
      });
      return row?.pulseSubAccountQuota ?? null;
    } catch (error: unknown) {
      if (!isMissingSubAccountQuotaSchemaError(error)) {
        throw error;
      }
      return null;
    }
  }
}
