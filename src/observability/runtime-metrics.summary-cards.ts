import {
  SUMMARY_ACTION_TEXT_MODE,
  SUMMARY_ACTION_VERSION,
  SUMMARY_PROTOCOL_VERSION,
} from './metrics.protocol';
import type {
  MetricsSummary,
  MetricsSummaryCachePrewarmCard,
  MetricsSummaryHttpCard,
  MetricsSummaryProcessCard,
  MetricsSummarySqlCard,
  MetricsSummaryRedisCard,
  SummaryActionId,
  SummaryActionParams,
  SummaryActionPayload,
  SummaryActionTarget,
  SummaryActionType,
  SummaryHighlight,
  SummaryImpactLevel,
  SummaryImpactScope,
  SummaryOwnerType,
} from './metrics.protocol';
import { MAX_TOP_HIGHLIGHTS } from './runtime-metrics.state';
import type { SummaryBuildContext } from './runtime-metrics.summary-context.types';

type SummaryCardActionMeta = {
  actionId: SummaryActionId;
  actionType: SummaryActionType;
  actionText: string;
  actionTarget: SummaryActionTarget;
  actionParams: SummaryActionParams;
  actionPayload: SummaryActionPayload;
  owner: string;
  ownerType: SummaryOwnerType;
  responsibleTeam: string;
  eta: string;
  impactLevel: SummaryImpactLevel;
  impactScope: SummaryImpactScope;
};

function buildCardActionFields(meta: SummaryCardActionMeta) {
  return {
    actionId: meta.actionId,
    actionVersion: SUMMARY_ACTION_VERSION,
    actionType: meta.actionType,
    actionText: meta.actionText,
    actionTextMode: SUMMARY_ACTION_TEXT_MODE,
    actionTarget: meta.actionTarget,
    actionParams: meta.actionParams,
    actionPayload: meta.actionPayload,
    owner: meta.owner,
    ownerType: meta.ownerType,
    responsibleTeam: meta.responsibleTeam,
    eta: meta.eta,
    impactLevel: meta.impactLevel,
    impactScope: meta.impactScope,
  };
}

function buildProcessCard(
  context: SummaryBuildContext,
): MetricsSummaryProcessCard {
  const {
    metrics: input,
    severity,
    trend,
    processMemoryPressurePercent,
  } = context;
  const { processActionMeta } = context;

  const label =
    severity.process === 'critical'
      ? '进程资源紧张'
      : severity.process === 'warning'
        ? '进程资源波动'
        : '进程运行正常';
  const message =
    severity.process === 'critical'
      ? `CPU ${input.process.approxCpuUtilizationPercent}% / 堆使用 ${processMemoryPressurePercent}% / RSS ${input.process.rssMb}MB，需尽快关注实例资源。`
      : severity.process === 'warning'
        ? `CPU ${input.process.approxCpuUtilizationPercent}% / 堆使用 ${processMemoryPressurePercent}% / RSS ${input.process.rssMb}MB，资源出现上升趋势。`
        : 'CPU 与内存资源保持稳定。';
  const suggestion =
    severity.process === 'healthy'
      ? '继续按常规资源阈值巡检即可。'
      : '建议查看实例 CPU、内存与 RSS 曲线，确认是否存在资源争用。';

  return {
    severity: severity.process,
    trend: trend.process,
    label,
    message,
    suggestion,
    ...buildCardActionFields(processActionMeta),
    rssMb: input.process.rssMb,
    heapUsedMb: input.process.heapUsedMb,
    approxCpuUtilizationPercent: input.process.approxCpuUtilizationPercent,
    memoryPressurePercent: processMemoryPressurePercent,
  };
}

function buildHttpCard(context: SummaryBuildContext): MetricsSummaryHttpCard {
  const {
    metrics: input,
    severity,
    trend,
    httpErrorRatePercent,
    httpSlowRatePercent,
    totalHttpSlowRequests,
    httpActionMeta,
  } = context;

  const label =
    severity.http === 'critical'
      ? '接口异常'
      : severity.http === 'warning'
        ? '接口波动'
        : '接口运行正常';
  const message =
    severity.http === 'critical'
      ? `5xx 错误率 ${httpErrorRatePercent}%，慢请求占比 ${httpSlowRatePercent}%。`
      : severity.http === 'warning'
        ? `存在 ${totalHttpSlowRequests} 个慢请求，峰值耗时 ${input.http.maxDurationMs}ms。`
        : '接口成功率与耗时表现正常。';
  const suggestion =
    severity.http === 'healthy'
      ? '继续关注核心接口成功率与耗时基线。'
      : '建议查看 `http.topRoutes` 与 `http.recentSlowRequests`，优先定位异常路由。';

  return {
    severity: severity.http,
    trend: trend.http,
    label,
    message,
    suggestion,
    ...buildCardActionFields(httpActionMeta),
    totalRequests: input.http.totalRequests,
    errorRequests: input.http.errorRequests,
    errorRatePercent: httpErrorRatePercent,
    avgDurationMs: input.http.avgDurationMs,
    maxDurationMs: input.http.maxDurationMs,
    slowRequestCount: totalHttpSlowRequests,
    slowRequestRatePercent: httpSlowRatePercent,
    latestSlowRequestAt: input.http.recentSlowRequests[0]?.capturedAt ?? null,
    topRoute: input.http.topRoutes[0] ?? null,
  };
}

function buildSqlCard(context: SummaryBuildContext): MetricsSummarySqlCard {
  const {
    metrics: input,
    severity,
    trend,
    sqlSlowQueryRatePercent,
    sqlActionMeta,
  } = context;

  const label =
    severity.sql === 'critical'
      ? '数据库查询偏慢'
      : severity.sql === 'warning'
        ? '数据库查询波动'
        : '数据库查询正常';
  const message =
    severity.sql === 'critical'
      ? `慢查询率 ${sqlSlowQueryRatePercent}%，最大耗时 ${input.sql.maxDurationMs}ms。`
      : severity.sql === 'warning'
        ? `已观测到 ${input.sql.slowQueries} 次慢查询，建议关注热点 SQL。`
        : '数据库查询耗时稳定。';
  const suggestion =
    severity.sql === 'healthy'
      ? '继续关注核心 SQL 的耗时基线。'
      : '建议查看 `sql.recentSlowQueries` 与 `sql.byOperation`，优先定位慢 SQL。';

  return {
    severity: severity.sql,
    trend: trend.sql,
    label,
    message,
    suggestion,
    ...buildCardActionFields(sqlActionMeta),
    totalQueries: input.sql.totalQueries,
    slowQueries: input.sql.slowQueries,
    slowQueryRatePercent: sqlSlowQueryRatePercent,
    avgDurationMs: input.sql.avgDurationMs,
    maxDurationMs: input.sql.maxDurationMs,
    latestSlowQueryAt: input.sql.recentSlowQueries[0]?.capturedAt ?? null,
    topOperation: input.sql.byOperation[0] ?? null,
  };
}

function buildRedisCard(context: SummaryBuildContext): MetricsSummaryRedisCard {
  const {
    metrics: input,
    severity,
    trend,
    totalRedisSlowCalls,
    totalRedisResolvedCalls,
    redisOverallHitRatePercent,
    redisActionMeta,
  } = context;

  const isLowHitRate =
    totalRedisResolvedCalls > 0 && redisOverallHitRatePercent < 85;
  const label =
    severity.redis === 'critical'
      ? isLowHitRate
        ? 'Redis 命中率偏低'
        : 'Redis 响应异常'
      : severity.redis === 'warning'
        ? isLowHitRate
          ? 'Redis 命中率波动'
          : 'Redis 响应偏慢'
        : 'Redis 运行正常';
  const message =
    severity.redis === 'critical'
      ? isLowHitRate
        ? `当前命中率 ${redisOverallHitRatePercent}%，缓存收益下降明显。`
        : `已出现 ${totalRedisSlowCalls} 次慢操作，最大耗时 ${input.redis.maxDurationMs}ms。`
      : severity.redis === 'warning'
        ? isLowHitRate
          ? `当前命中率 ${redisOverallHitRatePercent}%，建议关注缓存预热与过期策略。`
          : `慢操作 ${totalRedisSlowCalls} 次，建议关注 Redis 热点命令。`
        : 'Redis 命中率与耗时表现正常。';
  const suggestion =
    severity.redis === 'healthy'
      ? '继续关注命中率和热点命令变化。'
      : '建议查看 `redis.commands` 与 `redis.recentSlowOperations`，确认命中率下降或热点命令。';

  return {
    severity: severity.redis,
    trend: trend.redis,
    label,
    message,
    suggestion,
    ...buildCardActionFields(redisActionMeta),
    totalCalls: input.redis.totalCalls,
    avgDurationMs: input.redis.avgDurationMs,
    maxDurationMs: input.redis.maxDurationMs,
    slowOperationCount: totalRedisSlowCalls,
    overallHitRatePercent: redisOverallHitRatePercent,
    latestSlowOperationAt:
      input.redis.recentSlowOperations[0]?.capturedAt ?? null,
    topCommand: input.redis.commands[0] ?? null,
  };
}

function buildCachePrewarmCard(
  context: SummaryBuildContext,
): MetricsSummaryCachePrewarmCard {
  const {
    metrics: input,
    severity,
    trend,
    totalPrewarmKeys,
    cachePrewarmFailureRatePercent,
    hottestCategoryByP95,
    latestCycle,
    latestFailedCategory,
    mostFailedCategory,
    cachePrewarmActionMeta,
  } = context;

  const label =
    severity.cachePrewarm === 'critical'
      ? input.cachePrewarm.failedCount > 0
        ? '缓存预热异常'
        : '缓存预热耗时过高'
      : severity.cachePrewarm === 'warning'
        ? input.cachePrewarm.invalidCount > 0
          ? '缓存预热存在无效 Key'
          : '缓存预热波动'
        : '缓存预热正常';
  const message =
    severity.cachePrewarm === 'critical'
      ? input.cachePrewarm.failedCount > 0
        ? `累计失败 ${input.cachePrewarm.failedCount} 次，失败率 ${cachePrewarmFailureRatePercent}%。`
        : `预热峰值耗时 ${input.cachePrewarm.maxDurationMs}ms，需关注慢 Key。`
      : severity.cachePrewarm === 'warning'
        ? input.cachePrewarm.invalidCount > 0
          ? `检测到 ${input.cachePrewarm.invalidCount} 个无效 Key 被跳过。`
          : `最热类别 P95 达 ${hottestCategoryByP95?.p95DurationMs ?? 0}ms，建议继续观察。`
        : '热点缓存预热稳定，无明显失败。';
  const suggestion =
    severity.cachePrewarm === 'healthy'
      ? '继续观察热点预热命中与耗时分布。'
      : '建议查看 `cachePrewarm.recentCycles`、`cachePrewarm.failedReasonTopN` 和 `cachePrewarm.lastFailedSampleByCategory`。';

  return {
    severity: severity.cachePrewarm,
    trend: trend.cachePrewarm,
    label,
    message,
    suggestion,
    ...buildCardActionFields(cachePrewarmActionMeta),
    totalCycles: input.cachePrewarm.totalCycles,
    totalKeys: totalPrewarmKeys,
    failedCount: input.cachePrewarm.failedCount,
    invalidCount: input.cachePrewarm.invalidCount,
    failureRatePercent: cachePrewarmFailureRatePercent,
    avgDurationMs: input.cachePrewarm.avgDurationMs,
    maxDurationMs: input.cachePrewarm.maxDurationMs,
    lastDurationMs: input.cachePrewarm.lastDurationMs,
    lastSeenAt: input.cachePrewarm.lastSeenAt,
    latestCycle,
    hottestCategoryByP95,
    mostFailedCategory,
    latestFailedCategory,
    topFailedReason: input.cachePrewarm.failedReasonTopN[0] ?? null,
  };
}

export function buildMetricsSummaryResult(
  context: SummaryBuildContext,
  highlights: SummaryHighlight[],
): MetricsSummary {
  const { metrics: input, status, severity } = context;
  const topHighlights = highlights.slice(0, MAX_TOP_HIGHLIGHTS);

  return {
    protocolVersion: SUMMARY_PROTOCOL_VERSION,
    actionTextMode: SUMMARY_ACTION_TEXT_MODE,
    generatedAt: input.generatedAt,
    status,
    severity,
    highlights,
    topHighlights,
    overview: {
      uptimeSeconds: input.process.uptimeSeconds,
      totalRequests: input.http.totalRequests,
      totalQueries: input.sql.totalQueries,
      totalRedisCalls: input.redis.totalCalls,
      totalPrewarmCycles: input.cachePrewarm.totalCycles,
    },
    process: buildProcessCard(context),
    http: buildHttpCard(context),
    sql: buildSqlCard(context),
    redis: buildRedisCard(context),
    cachePrewarm: buildCachePrewarmCard(context),
  };
}
