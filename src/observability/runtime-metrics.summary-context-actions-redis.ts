import type {
  SummaryActionParamsById,
  SummaryStatus,
} from './metrics.protocol';
import { buildRedisActionPayload } from './runtime-metrics.summary-actions';
import { buildDrawerActionMeta } from './runtime-metrics.summary-context-actions-shared';
import type {
  SummaryHighlightActionMeta,
  SummaryMetricsInput,
} from './runtime-metrics.summary-context.types';

export function buildRedisActionMeta(
  input: SummaryMetricsInput,
  severity: SummaryStatus,
  totalRedisResolvedCalls: number,
  redisOverallHitRatePercent: number,
): SummaryHighlightActionMeta {
  const lowHitRate =
    totalRedisResolvedCalls > 0 && redisOverallHitRatePercent < 85;
  const actionId = lowHitRate
    ? 'open_redis_commands'
    : 'open_redis_slow_operations';
  const actionParams: SummaryActionParamsById[typeof actionId] = lowHitRate
    ? {
        section: 'redis',
        tab: 'commands',
        command: input.redis.commands[0]?.command ?? null,
      }
    : {
        section: 'redis',
        tab: 'slowOperations',
        command: input.redis.commands[0]?.command ?? null,
      };

  return {
    ...buildDrawerActionMeta({
      actionId,
      actionText: lowHitRate ? '查看命中率明细' : '查看 Redis 慢操作',
      severity,
      owner: '缓存负责人',
      ownerType: 'cache_owner',
      responsibleTeam: '缓存中间件团队',
      impactScope: 'cache',
      actionParams,
      buildPayload: (params) => buildRedisActionPayload(lowHitRate, params.command),
    }),
  };
}
