import type { BusinessAnalysisService } from '../purely-profit/dashboard/business-analysis/business-analysis.service';
import type { DashboardHomeService } from '../purely-profit/dashboard/dashboard-home/dashboard-home.service';
import type { FinanceOverviewService } from '../purely-profit/finance/finance-overview.service';
import type { MarketingOverviewService } from '../purely-profit/marketing/marketing-overview.service';
import type { MembersService } from '../purely-profit/member/members/members.service';
import type { CachePrewarmCategoryConfig } from './cache-prewarm.types';

export type CachePrewarmProfitReadConfigInput = {
  dashboardHomeService: Pick<DashboardHomeService, 'warmOverviewCache'>;
  businessAnalysisService: Pick<BusinessAnalysisService, 'warmAnalysisCache'>;
  marketingOverviewService: Pick<MarketingOverviewService, 'warmOverviewCache'>;
  membersService: Pick<MembersService, 'warmMetaCache' | 'warmOverviewCache'>;
};

export type CachePrewarmFinanceConfigInput = {
  financeOverviewService: Pick<FinanceOverviewService, 'warmOverviewCache'>;
};

export type CachePrewarmCategoryConfigInput =
  CachePrewarmProfitReadConfigInput & CachePrewarmFinanceConfigInput;

export type CachePrewarmProvider<
  TInput extends object,
  TConfig extends CachePrewarmCategoryConfig = CachePrewarmCategoryConfig,
> = (input: TInput) => TConfig;

export type CachePrewarmCategoryConfigProvider<TInput extends object> =
  CachePrewarmProvider<TInput>;

export type CachePrewarmProfitReadCategoryConfigProvider =
  CachePrewarmProvider<CachePrewarmProfitReadConfigInput>;

export type CachePrewarmFinanceCategoryConfigProvider =
  CachePrewarmProvider<CachePrewarmFinanceConfigInput>;
