import { Injectable } from '@nestjs/common';
import { CacheInvalidatorFinanceService } from './cache-invalidator-finance.service';
import { CacheInvalidatorMembershipService } from './cache-invalidator-membership.service';
import { CacheInvalidatorProfitReadService } from './cache-invalidator-profit-read.service';
import { CacheInvalidatorPulseService } from './cache-invalidator-pulse.service';

@Injectable()
export class CacheInvalidatorService {
  constructor(
    private readonly profitReadInvalidator: CacheInvalidatorProfitReadService,
    private readonly financeInvalidator: CacheInvalidatorFinanceService,
    private readonly pulseInvalidator: CacheInvalidatorPulseService,
    private readonly membershipInvalidator: CacheInvalidatorMembershipService,
  ) {}

  async invalidateProfitDashboardHome(storeId: number): Promise<void> {
    await this.profitReadInvalidator.invalidateProfitDashboardHome(storeId);
  }

  async invalidateBusinessAnalysis(storeId: number): Promise<void> {
    await this.profitReadInvalidator.invalidateBusinessAnalysis(storeId);
  }

  async invalidateFinanceOverview(storeId: number): Promise<void> {
    await this.financeInvalidator.invalidateFinanceOverview(storeId);
  }

  async invalidateFinanceCashFlow(storeId: number): Promise<void> {
    await this.financeInvalidator.invalidateFinanceCashFlow(storeId);
  }

  async invalidateFinanceAccounts(storeId: number): Promise<void> {
    await this.financeInvalidator.invalidateFinanceAccounts(storeId);
  }

  async invalidateFinanceReconciliations(storeId: number): Promise<void> {
    await this.financeInvalidator.invalidateFinanceReconciliations(storeId);
  }

  async invalidateMarketingOverview(storeId: number): Promise<void> {
    await this.profitReadInvalidator.invalidateMarketingOverview(storeId);
  }

  async invalidateMembersDerived(storeId: number): Promise<void> {
    await this.membershipInvalidator.invalidateMembersDerived(storeId);
  }

  async invalidateWithdrawalsDerived(storeId: number): Promise<void> {
    await this.membershipInvalidator.invalidateWithdrawalsDerived(storeId);
  }

  async invalidatePlatformMembershipDerived(storeId: number): Promise<void> {
    await this.membershipInvalidator.invalidatePlatformMembershipDerived(
      storeId,
    );
  }

  async invalidateSalesReadCaches(storeId: number): Promise<void> {
    await this.profitReadInvalidator.invalidateSalesReadCaches(storeId);
  }

  async invalidatePulseDashboardHome(): Promise<void> {
    await this.pulseInvalidator.invalidatePulseDashboardHome();
  }

  async invalidatePulseDashboardRevenueDetail(): Promise<void> {
    await this.pulseInvalidator.invalidatePulseDashboardRevenueDetail();
  }

  async invalidatePulseDashboardOverview(storeId: number): Promise<void> {
    await this.pulseInvalidator.invalidatePulseDashboardOverview(storeId);
  }

  async invalidatePulseGrowthEarnings(storeId: number): Promise<void> {
    await this.pulseInvalidator.invalidatePulseGrowthEarnings(storeId);
  }

  async invalidatePulseGrowthAdminQueries(): Promise<void> {
    await this.pulseInvalidator.invalidatePulseGrowthAdminQueries();
  }

  async invalidatePulseSessionNotification(storeId: number): Promise<void> {
    await this.pulseInvalidator.invalidatePulseSessionNotification(storeId);
  }

  async invalidatePulseSessionBootstrap(storeId: number): Promise<void> {
    await this.pulseInvalidator.invalidatePulseSessionBootstrap(storeId);
  }

  async invalidatePulseSessionBootstrapByUser(userId: number): Promise<void> {
    await this.pulseInvalidator.invalidatePulseSessionBootstrapByUser(userId);
  }

  async invalidatePulseOnboardingStatus(storeId: number): Promise<void> {
    await this.pulseInvalidator.invalidatePulseOnboardingStatus(storeId);
  }

  async invalidatePulseOnboardingStatusByUser(userId: number): Promise<void> {
    await this.pulseInvalidator.invalidatePulseOnboardingStatusByUser(userId);
  }

  async invalidateDashboardAndPulseSession(storeId: number): Promise<void> {
    await Promise.all([
      this.profitReadInvalidator.invalidateProfitDashboardHome(storeId),
      this.pulseInvalidator.invalidateDashboardAndPulseSession(storeId),
    ]);
  }

  async invalidateFinanceDerived(storeId: number): Promise<void> {
    await Promise.all([
      this.profitReadInvalidator.invalidateBusinessAnalysis(storeId),
      this.financeInvalidator.invalidateFinanceOverview(storeId),
      this.financeInvalidator.invalidateFinanceCashFlow(storeId),
      this.financeInvalidator.invalidateFinanceAccounts(storeId),
      this.financeInvalidator.invalidateFinanceReconciliations(storeId),
    ]);
  }

  async invalidateSalesDerived(storeId: number): Promise<void> {
    await Promise.all([
      this.profitReadInvalidator.invalidateProfitDashboardHome(storeId),
      this.profitReadInvalidator.invalidateBusinessAnalysis(storeId),
      this.financeInvalidator.invalidateFinanceOverview(storeId),
      this.profitReadInvalidator.invalidateSalesReadCaches(storeId),
      this.pulseInvalidator.invalidatePulseDashboardOverview(storeId),
      this.pulseInvalidator.invalidatePulseSessionNotification(storeId),
      this.pulseInvalidator.invalidatePulseSessionBootstrap(storeId),
      this.pulseInvalidator.invalidatePulseOnboardingStatus(storeId),
    ]);
  }

  async invalidateMembershipDerived(storeId: number): Promise<void> {
    await this.membershipInvalidator.invalidateMembershipDerived(storeId);
  }
}
