import type {
  SummaryActionParamsById,
  SummaryStatus,
} from './metrics.protocol';
import { buildCachePrewarmActionPayload } from './runtime-metrics.summary-actions';
import { buildDrawerActionMeta } from './runtime-metrics.summary-context-actions-shared';
import type {
  SummaryHighlightActionMeta,
  SummaryMetricsInput,
} from './runtime-metrics.summary-context.types';

export function buildCachePrewarmActionMeta(
  input: SummaryMetricsInput,
  severity: SummaryStatus,
  hottestCategory: SummaryActionParamsById['open_cache_prewarm_recent_cycles']['category'],
  latestFailedCategory: SummaryActionParamsById['open_cache_prewarm_recent_cycles']['category'],
): SummaryHighlightActionMeta {
  const hasFailures = input.cachePrewarm.failedCount > 0;
  const actionId = hasFailures
    ? 'open_cache_prewarm_failed_samples'
    : 'open_cache_prewarm_recent_cycles';
  const category = latestFailedCategory ?? hottestCategory ?? null;
  const actionParams: SummaryActionParamsById[typeof actionId] = hasFailures
    ? {
        section: 'cachePrewarm',
        tab: 'failedSamples',
        category,
      }
    : {
        section: 'cachePrewarm',
        tab: 'recentCycles',
        category,
      };

  return {
    ...buildDrawerActionMeta({
      actionId,
      actionText: hasFailures ? '查看预热失败样本' : '查看预热周期明细',
      severity,
      owner: '缓存预热负责人',
      ownerType: 'prewarm_owner',
      responsibleTeam: '后端 API 团队',
      impactScope: 'cache_prewarm',
      eta: severity === 'critical' ? '15 分钟内' : undefined,
      impactLevel: hasFailures && severity === 'critical' ? 'urgent' : undefined,
      actionParams,
      buildPayload: (params) =>
        buildCachePrewarmActionPayload(
          hasFailures,
          input.cachePrewarm.invalidCount,
          params.category,
        ),
    }),
  };
}
