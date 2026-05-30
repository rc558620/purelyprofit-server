import type { SummaryHighlight } from './metrics.protocol';
import type { SummaryBuildContext } from './runtime-metrics.summary-context.types';
import { buildSummaryHighlight } from './runtime-metrics.summary-highlights-shared';

export function buildHttpSummaryHighlights(
  context: SummaryBuildContext,
): SummaryHighlight[] {
  const {
    metrics: input,
    severity,
    totalHttpSlowRequests,
    httpErrorRatePercent,
    httpActionMeta,
  } = context;

  if (severity.http === 'healthy') {
    return [];
  }

  return [
    buildSummaryHighlight({
      domain: 'http',
      severity: severity.http,
      priority: httpErrorRatePercent > 0 ? 95 : 70,
      code:
        httpErrorRatePercent > 0 ? 'HTTP_ERROR_RATE_HIGH' : 'HTTP_LATENCY_HIGH',
      title:
        httpErrorRatePercent > 0
          ? 'HTTP error rate is elevated'
          : 'HTTP latency is elevated',
      detail:
        httpErrorRatePercent > 0
          ? `${input.http.errorRequests}/${input.http.totalRequests} requests returned 5xx`
          : `${totalHttpSlowRequests} slow requests observed`,
      label: httpErrorRatePercent > 0 ? '接口异常率升高' : '接口耗时升高',
      message:
        httpErrorRatePercent > 0
          ? `当前 5xx 错误率 ${httpErrorRatePercent}%，请优先排查异常接口。`
          : `当前慢请求 ${totalHttpSlowRequests} 个，峰值耗时 ${input.http.maxDurationMs}ms。`,
      actionMeta: httpActionMeta,
      value:
        httpErrorRatePercent > 0
          ? httpErrorRatePercent
          : input.http.maxDurationMs,
      observedAt: input.http.topRoutes[0]?.lastSeenAt ?? input.generatedAt,
    }),
  ];
}
