import { buildProcessActionPayload } from './runtime-metrics.summary-actions';
import type { SummaryHighlight } from './metrics-summary.protocol';
import type { SummaryBuildContext } from './runtime-metrics.summary-context.types';
import { buildSummaryHighlight } from './runtime-metrics.summary-highlights-shared';

export function buildProcessSummaryHighlights(
  context: SummaryBuildContext,
): SummaryHighlight[] {
  const {
    metrics: input,
    severity,
    processMemoryPressurePercent,
    processActionMeta,
  } = context;

  if (severity.process === 'healthy') {
    return [];
  }

  if (input.process.approxCpuUtilizationPercent >= 60) {
    return [
      buildSummaryHighlight({
        domain: 'process',
        severity: severity.process,
        priority: severity.process === 'critical' ? 90 : 60,
        code: 'PROCESS_CPU_PRESSURE',
        title: 'Process CPU usage is elevated',
        detail: `CPU utilization is ${input.process.approxCpuUtilizationPercent}%`,
        label: '进程 CPU 压力升高',
        message: `进程 CPU 使用率达到 ${input.process.approxCpuUtilizationPercent}%。`,
        actionMeta: processActionMeta,
        actionParams: {
          ...processActionMeta.actionParams,
          focus: 'cpu',
        },
        actionPayload: buildProcessActionPayload('cpu', severity.process),
        value: input.process.approxCpuUtilizationPercent,
        observedAt: input.generatedAt,
      }),
    ];
  }

  if (processMemoryPressurePercent >= 75) {
    return [
      buildSummaryHighlight({
        domain: 'process',
        severity: severity.process,
        priority: severity.process === 'critical' ? 88 : 58,
        code: 'PROCESS_HEAP_PRESSURE',
        title: 'Process heap pressure is elevated',
        detail: `Heap usage is ${processMemoryPressurePercent}% of total heap`,
        label: '进程堆内存压力升高',
        message: `堆内存使用率达到 ${processMemoryPressurePercent}%。`,
        actionMeta: processActionMeta,
        actionParams: {
          ...processActionMeta.actionParams,
          focus: 'heap',
        },
        actionPayload: buildProcessActionPayload('heap', severity.process),
        value: processMemoryPressurePercent,
        observedAt: input.generatedAt,
      }),
    ];
  }

  return [
    buildSummaryHighlight({
      domain: 'process',
      severity: severity.process,
      priority: severity.process === 'critical' ? 86 : 56,
      code: 'PROCESS_RSS_PRESSURE',
      title: 'Process memory footprint is elevated',
      detail: `RSS memory is ${input.process.rssMb} MB`,
      label: '进程常驻内存偏高',
      message: `RSS 内存达到 ${input.process.rssMb}MB。`,
      actionMeta: processActionMeta,
      actionParams: {
        ...processActionMeta.actionParams,
        focus: 'rss',
      },
      actionPayload: buildProcessActionPayload('rss', severity.process),
      value: input.process.rssMb,
      observedAt: input.generatedAt,
    }),
  ];
}
