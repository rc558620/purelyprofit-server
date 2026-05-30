import type { SummaryHighlight } from './metrics.protocol';
import type { SummaryBuildContext } from './runtime-metrics.summary-context.types';
import { buildSummaryHighlight } from './runtime-metrics.summary-highlights-shared';

export function buildSqlSummaryHighlights(
  context: SummaryBuildContext,
): SummaryHighlight[] {
  const {
    metrics: input,
    severity,
    sqlSlowQueryRatePercent,
    sqlActionMeta,
  } = context;

  if (severity.sql === 'healthy') {
    return [];
  }

  return [
    buildSummaryHighlight({
      domain: 'sql',
      severity: severity.sql,
      priority: severity.sql === 'critical' ? 85 : 62,
      code: 'SQL_SLOW_QUERY_RATE_HIGH',
      title: 'SQL slow query rate is elevated',
      detail: `${input.sql.slowQueries}/${input.sql.totalQueries} queries crossed the slow threshold`,
      label:
        severity.sql === 'critical' ? '数据库查询偏慢' : '数据库查询出现波动',
      message: `慢查询率 ${sqlSlowQueryRatePercent}%，最大耗时 ${input.sql.maxDurationMs}ms。`,
      actionMeta: sqlActionMeta,
      value: sqlSlowQueryRatePercent,
      observedAt:
        input.sql.recentSlowQueries[0]?.capturedAt ?? input.generatedAt,
    }),
  ];
}
