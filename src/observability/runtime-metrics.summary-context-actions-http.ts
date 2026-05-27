import type {
  SummaryActionParamsById,
  SummaryStatus,
} from './metrics.protocol';
import { buildHttpActionPayload } from './runtime-metrics.summary-actions';
import { buildDrawerActionMeta } from './runtime-metrics.summary-context-actions-shared';
import type {
  SummaryHighlightActionMeta,
  SummaryMetricsInput,
} from './runtime-metrics.summary-context.types';

export function buildHttpActionMeta(
  input: SummaryMetricsInput,
  severity: SummaryStatus,
  httpErrorRatePercent: number,
): SummaryHighlightActionMeta {
  const actionId =
    httpErrorRatePercent > 0
      ? 'open_http_top_routes'
      : 'open_http_slow_requests';
  const actionParams: SummaryActionParamsById[typeof actionId] =
    httpErrorRatePercent > 0
      ? {
          section: 'http',
          tab: 'topRoutes',
          route: input.http.topRoutes[0]?.route ?? null,
        }
      : {
          section: 'http',
          tab: 'slowRequests',
          route: input.http.topRoutes[0]?.route ?? null,
        };

  return {
    ...buildDrawerActionMeta({
      actionId,
      actionText: httpErrorRatePercent > 0 ? '查看异常路由' : '查看慢请求明细',
      severity,
      owner: '接口值班',
      ownerType: 'api_owner',
      responsibleTeam: '后端 API 团队',
      impactScope: 'route',
      eta: severity === 'critical' ? '15 分钟内' : undefined,
      impactLevel:
        httpErrorRatePercent > 0 && severity === 'critical' ? 'urgent' : undefined,
      actionParams,
      buildPayload: (params) =>
        buildHttpActionPayload(httpErrorRatePercent > 0, params.route),
    }),
  };
}
