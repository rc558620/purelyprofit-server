import type { SummaryActionParamsById } from './metrics-summary.protocol';
import { buildProcessActionPayload } from './runtime-metrics.summary-actions';
import { buildDrawerActionMeta } from './runtime-metrics.summary-context-actions-shared';
import type {
  SummaryMetricsInput,
  SummaryProcessActionMeta,
} from './runtime-metrics.summary-context.types';

export function buildProcessActionMeta(
  input: SummaryMetricsInput,
  severity: SummaryProcessActionMeta['actionParams']['severity'],
  processMemoryPressurePercent: number,
): SummaryProcessActionMeta {
  const actionId = 'open_process_resource_panel' as const;
  const actionParams: SummaryActionParamsById['open_process_resource_panel'] = {
    section: 'process',
    focus:
      input.process.approxCpuUtilizationPercent >= 60
        ? 'cpu'
        : processMemoryPressurePercent >= 75
          ? 'heap'
          : 'rss',
    severity,
  };

  return {
    ...buildDrawerActionMeta({
      actionId,
      actionText: '查看进程资源',
      severity,
      owner: '后端值班',
      ownerType: 'backend_oncall',
      responsibleTeam: '基础设施团队',
      impactScope: 'instance',
      actionParams,
      buildPayload: (params) =>
        buildProcessActionPayload(params.focus, params.severity),
    }),
  };
}
