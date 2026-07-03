/**
 * 缓存键统一入口
 *
 * 本文件作为 cache-keys 相关能力的对外导出桶，
 * 将 redis 通用键构建函数与领域键统一命名空间。
 */

// 共享工具
export { buildCacheRefreshTaskKey } from '../cache-keys.shared';

// Redis 域级键 — Dashboard
export {
  buildProfitDashboardHomeCacheKey,
  buildProfitDashboardHomeStatsCacheKey,
  buildProfitDashboardHomeTrendCacheKey,
  buildProfitDashboardHomeActivitiesCacheKey,
  buildProfitDashboardHomePattern,
  buildProfitDashboardHomeChunkPattern,
  buildProfitDashboardHomeAllPattern,
  parseProfitDashboardHomeCacheKey,
} from './dashboard.cache-keys';

// Redis 域级键 — Business Analysis
export {
  buildBusinessAnalysisCacheKey,
  buildBusinessAnalysisPattern,
  buildBusinessAnalysisAllPattern,
  parseBusinessAnalysisCacheKey,
} from './business-analysis.cache-keys';

// Redis 域级键 — Marketing
export {
  buildMarketingOverviewCacheKey,
  buildMarketingOverviewPattern,
  buildMarketingOverviewAllPattern,
  parseMarketingOverviewCacheKey,
  buildMarketingPromotionsListCacheKey,
  buildMarketingPromotionsListPattern,
  buildMarketingCustomersListCacheKey,
  buildMarketingCustomersListPattern,
} from './marketing.cache-keys';

// Redis 域级键 — Members / Withdrawals / Platform Membership
export {
  buildMembersListCacheKey,
  buildMembersListPattern,
  buildMembersMetaCacheKey,
  buildMembersMetaPattern,
  buildMembersMetaAllPattern,
  parseMembersMetaCacheKey,
  buildMembersOverviewCacheKey,
  buildMembersOverviewPattern,
  buildMembersOverviewAllPattern,
  parseMembersOverviewCacheKey,
  buildWithdrawalsOverviewCacheKey,
  buildWithdrawalsListCacheKey,
  buildWithdrawalsListPattern,
  buildPlatformMembershipCenterCacheKey,
  buildPlatformMembershipProfileCacheKey,
  buildPlatformMembershipOrdersCacheKey,
  buildPlatformMembershipPointsLogsCacheKey,
  buildPlatformMembershipBeanLogsCacheKey,
  buildPlatformMembershipPromoCenterCacheKey,
  buildPlatformMembershipPartnerProfileCacheKey,
  buildPlatformMembershipDerivedPattern,
} from './members.cache-keys';

// Redis 域级键 — Sales
export {
  buildSalesStatsCacheKey,
  buildSalesStatsPattern,
  buildSalesReportCacheKey,
  buildSalesReportPattern,
} from './sales.cache-keys';

// Redis 域级键 — Profit Detail / Report
export {
  buildProfitDetailCacheKey,
  buildProfitDetailPattern,
  buildProfitDetailAllPattern,
  parseProfitDetailCacheKey,
  buildProfitReportCacheKey,
  buildProfitReportPattern,
  buildProfitReportAllPattern,
  parseProfitReportCacheKey,
} from './profit-detail.cache-keys';

// Redis 域级键 — Costs
export {
  buildCostsStatsCacheKey,
  buildCostsStatsPattern,
  buildCostsReportCacheKey,
  buildCostsReportPattern,
  buildCostsReportAllPattern,
  buildCostsRecordsCacheKey,
  buildCostsRecordsPattern,
  buildCostsAllPattern,
  buildCostsDashboardCacheKey,
  buildCostsDashboardPattern,
} from './costs.cache-keys';

// 领域键从各自域导出（保持语义）
export {
  buildFinanceAccountsListCacheKey,
  buildFinanceAccountsPattern,
  buildFinanceAccountsStatsCacheKey,
  buildFinanceCashFlowListCacheKey,
  buildFinanceCashFlowPattern,
  buildFinanceCashFlowStatsCacheKey,
  buildFinanceOverviewAllPattern,
  buildFinanceOverviewCacheKey,
  buildFinanceOverviewPattern,
  buildFinanceReconciliationsListCacheKey,
  buildFinanceReconciliationsPattern,
  buildFinanceReconciliationsStatsCacheKey,
  buildFinanceReportCacheKey,
  buildFinanceReportPattern,
  buildFinanceReportAllPattern,
  parseFinanceOverviewCacheKey,
} from '../../purely-profit/finance/finance.cache-keys';

export {
  buildPulseDashboardHomeCacheKey,
  buildPulseDashboardHomePattern,
  buildPulseDashboardOverviewCacheKey,
  buildPulseDashboardOverviewPattern,
  buildPulseDashboardRevenueDetailCacheKey,
  buildPulseDashboardRevenueDetailPattern,
  buildPulseGrowthAdminPartnerApplicationsCacheKey,
  buildPulseGrowthAdminPattern,
  buildPulseGrowthAdminPayoutsCacheKey,
  buildPulseGrowthEarningsLogsCacheKey,
  buildPulseGrowthEarningsOverviewCacheKey,
  buildPulseGrowthEarningsPattern,
  buildPulseOnboardingStatusCacheKey,
  buildPulseOnboardingStatusCacheKeyFromQuery,
  buildPulseOnboardingStatusPatternByStore,
  buildPulseOnboardingStatusPatternByUser,
  buildPulseSessionBootstrapCacheKey,
  buildPulseSessionBootstrapCacheKeyFromQuery,
  buildPulseSessionBootstrapPatternByStore,
  buildPulseSessionBootstrapPatternByUser,
  buildPulseSessionNotificationCacheKey,
} from '../../purely-pulse/pulse.cache-keys';
