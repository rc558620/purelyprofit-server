import type {
  SummaryActionParamsById,
  SummaryStatus,
} from './metrics-summary.protocol';
import { buildSqlActionPayload } from './runtime-metrics.summary-actions';
import { buildDrawerActionMeta } from './runtime-metrics.summary-context-actions-shared';
import type {
  SummaryHighlightActionMeta,
  SummaryMetricsInput,
} from './runtime-metrics.summary-context.types';

export function buildSqlActionMeta(
  input: SummaryMetricsInput,
  severity: SummaryStatus,
): SummaryHighlightActionMeta {
  const actionId = 'open_sql_slow_queries' as const;
  const actionParams: SummaryActionParamsById['open_sql_slow_queries'] = {
    section: 'sql',
    tab: 'slowQueries',
    operation: input.sql.byOperation[0]?.operation ?? null,
  };

  return {
    ...buildDrawerActionMeta({
      actionId,
      actionText: '查看慢 SQL',
      severity,
      owner: '数据查询负责人',
      ownerType: 'dba_owner',
      responsibleTeam: '后端 API / DBA',
      impactScope: 'database',
      actionParams,
      buildPayload: (params) => buildSqlActionPayload(params.operation),
    }),
  };
}
