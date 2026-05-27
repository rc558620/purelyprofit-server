import type {
  MetricsCachePrewarmSnapshot,
  MetricsHttpSnapshot,
  MetricsProcessSnapshot,
  MetricsRedisSnapshot,
  MetricsSqlSnapshot,
  MetricsSummarySeverityMap,
  SummaryActionId,
  SummaryActionParams,
  SummaryActionPayload,
  SummaryActionTarget,
  SummaryActionTargetById,
  SummaryActionType,
  SummaryDomain,
  SummaryImpactLevel,
  SummaryImpactScope,
  SummaryOwnerType,
  SummaryStatus,
  SummaryTrend,
} from './metrics.protocol';
import type { SummaryCachePrewarmDerivedData } from './runtime-metrics.summary-context-cache-prewarm';

export type SummaryMetricsInput = {
  generatedAt: string;
  process: MetricsProcessSnapshot;
  http: MetricsHttpSnapshot;
  sql: MetricsSqlSnapshot;
  redis: MetricsRedisSnapshot;
  cachePrewarm: MetricsCachePrewarmSnapshot;
};

type SharedSummaryActionMeta = {
  actionId: SummaryActionId;
  actionType: SummaryActionType;
  actionText: string;
  actionTarget: SummaryActionTarget;
  owner: string;
  ownerType: SummaryOwnerType;
  responsibleTeam: string;
  eta: string;
  impactLevel: SummaryImpactLevel;
  impactScope: SummaryImpactScope;
};

export type SummaryProcessActionMeta = SharedSummaryActionMeta & {
  actionId: 'open_process_resource_panel';
  actionTarget: SummaryActionTargetById['open_process_resource_panel'];
  actionParams: {
    section: 'process';
    focus: 'cpu' | 'heap' | 'rss';
    severity: SummaryStatus;
  };
  actionPayload: SummaryActionPayload;
};

export type SummaryHighlightActionMeta = SharedSummaryActionMeta & {
  actionParams: SummaryActionParams;
  actionPayload: SummaryActionPayload;
};

export type SummaryTrendMap = Record<SummaryDomain, SummaryTrend>;

export type SummaryAggregateMetrics = {
  totalHttpSlowRequests: number;
  totalRedisSlowCalls: number;
  totalRedisResolvedCalls: number;
  totalPrewarmKeys: number;
  httpErrorRatePercent: number;
  httpSlowRatePercent: number;
  sqlSlowQueryRatePercent: number;
  redisOverallHitRatePercent: number;
  cachePrewarmFailureRatePercent: number;
  processMemoryPressurePercent: number;
};

export type SummaryBuildContext = {
  metrics: SummaryMetricsInput;
  status: SummaryStatus;
  severity: MetricsSummarySeverityMap;
  trend: SummaryTrendMap;
  totalHttpSlowRequests: number;
  totalRedisSlowCalls: number;
  totalRedisResolvedCalls: number;
  totalPrewarmKeys: number;
  httpErrorRatePercent: number;
  httpSlowRatePercent: number;
  sqlSlowQueryRatePercent: number;
  redisOverallHitRatePercent: number;
  cachePrewarmFailureRatePercent: number;
  processMemoryPressurePercent: number;
  latestCycle: SummaryCachePrewarmDerivedData['latestCycle'];
  hottestCategoryByP95: SummaryCachePrewarmDerivedData['hottestCategoryByP95'];
  mostFailedCategory: SummaryCachePrewarmDerivedData['mostFailedCategory'];
  latestFailedCategory: SummaryCachePrewarmDerivedData['latestFailedCategory'];
  processActionMeta: SummaryProcessActionMeta;
  httpActionMeta: SummaryHighlightActionMeta;
  sqlActionMeta: SummaryHighlightActionMeta;
  redisActionMeta: SummaryHighlightActionMeta;
  cachePrewarmActionMeta: SummaryHighlightActionMeta;
};
