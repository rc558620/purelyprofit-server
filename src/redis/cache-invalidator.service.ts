import { Injectable, Logger } from '@nestjs/common';
import { CacheInvalidatorFinanceService } from './cache-invalidator-finance.service';
import { CacheInvalidatorMembershipService } from './cache-invalidator-membership.service';
import { CacheInvalidatorProfitReadService } from './cache-invalidator-profit-read.service';
import { CacheInvalidatorPulseService } from './cache-invalidator-pulse.service';

@Injectable()
export class CacheInvalidatorService {
  private readonly logger = new Logger(CacheInvalidatorService.name);

  constructor(
    private readonly profitReadInvalidator: CacheInvalidatorProfitReadService,
    private readonly financeInvalidator: CacheInvalidatorFinanceService,
    private readonly pulseInvalidator: CacheInvalidatorPulseService,
    private readonly membershipInvalidator: CacheInvalidatorMembershipService,
  ) {}

  async invalidateProfitDashboardHome(storeId: number): Promise<void> {
    await Promise.all([
      this.profitReadInvalidator.invalidateProfitDashboardHome(storeId),
      this.profitReadInvalidator.invalidateProfitDetail(storeId),
    ]);
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

  /**
   * 顾客维度营销缓存失效（概览 + 顾客列表 + 顾客详情）。
   * C 端落账路径统一用这个，避免商家端只能等 TTL 才看到余额/积分变化。
   */
  async invalidateMarketingCustomerDerived(storeId: number): Promise<void> {
    await this.profitReadInvalidator.invalidateMarketingCustomerDerived(
      storeId,
    );
  }

  async invalidateMembersDerived(storeId: number): Promise<void> {
    await Promise.all([
      this.membershipInvalidator.invalidateMembersDerived(storeId),
      // 首页动态依赖会员数据（今日新增会员、今日新增充值、高价值会员久未到店）
      this.profitReadInvalidator.invalidateProfitDashboardHome(storeId),
    ]);
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

  async invalidateSpacesReadCaches(storeId: number): Promise<void> {
    await this.profitReadInvalidator.invalidateSpacesReadCaches(storeId);
  }

  /**
   * 空间二维码图片产物失效（空间维度）。
   * 空间删除后调用，避免图片产物在 Redis 里滞留到 TTL。
   */
  async invalidateSpaceQrImageCache(spaceId: number): Promise<void> {
    await this.profitReadInvalidator.invalidateSpaceQrImageCache(spaceId);
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
      this.profitReadInvalidator.invalidateProfitDetail(storeId),
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
      this.financeInvalidator.invalidateFinanceReport(storeId),
    ]);
  }

  /**
   * 写后失效（静默）：事务已提交后缓存清理失败，不应把接口变成 500。
   *
   * 否则调用方看到失败会原样重试，把同一笔账款收付 / 流水 / 对账再写一次，
   * 造成账务重复入账。失败只记日志，缓存最多陈旧一个 TTL。
   */
  async invalidateFinanceDerivedQuietly(storeId: number): Promise<void> {
    await this.runQuietly('财务派生缓存失效', () =>
      this.invalidateFinanceDerived(storeId),
    );
  }

  async invalidateDashboardAndPulseSessionQuietly(
    storeId: number,
  ): Promise<void> {
    await this.runQuietly('首页与 Pulse 会话缓存失效', () =>
      this.invalidateDashboardAndPulseSession(storeId),
    );
  }

  async invalidateCostsCaches(storeId: number): Promise<void> {
    await this.profitReadInvalidator.invalidateCostsCaches(storeId);
  }

  async invalidateSalesDerived(storeId: number): Promise<void> {
    await Promise.all([
      this.profitReadInvalidator.invalidateProfitDashboardHome(storeId),
      this.profitReadInvalidator.invalidateBusinessAnalysis(storeId),
      // 销售写入/退款会新增或删除现金流水，并改变财务报表口径
      this.financeInvalidator.invalidateFinanceOverview(storeId),
      this.financeInvalidator.invalidateFinanceCashFlow(storeId),
      this.financeInvalidator.invalidateFinanceReport(storeId),
      this.profitReadInvalidator.invalidateSalesReadCaches(storeId),
      this.profitReadInvalidator.invalidateProfitDetail(storeId),
      this.profitReadInvalidator.invalidateCostsCaches(storeId),
      this.pulseInvalidator.invalidatePulseDashboardOverview(storeId),
      this.pulseInvalidator.invalidatePulseSessionNotification(storeId),
      this.pulseInvalidator.invalidatePulseSessionBootstrap(storeId),
      this.pulseInvalidator.invalidatePulseOnboardingStatus(storeId),
    ]);
  }

  async invalidateMembershipDerived(storeId: number): Promise<void> {
    await this.membershipInvalidator.invalidateMembershipDerived(storeId);
  }

  private async runQuietly(
    label: string,
    task: () => Promise<void>,
  ): Promise<void> {
    try {
      await task();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${label}失败（写入已提交，等待 TTL 自然过期）: ${reason}`,
      );
    }
  }
}
