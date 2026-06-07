import type {
  SummaryHighlight,
  SummaryImpactLevel,
  SummaryStatus,
  SummaryTrend,
} from './metrics-summary.protocol';
import { roundMetric } from './runtime-metrics.state';

export const SUMMARY_SEVERITY_RANK: Record<SummaryStatus, number> = {
  healthy: 0,
  warning: 1,
  critical: 2,
};

export function buildRatePercent(
  numerator: number,
  denominator: number,
): number {
  return denominator > 0 ? roundMetric((numerator / denominator) * 100) : 0;
}

export function maxSummaryStatus(...statuses: SummaryStatus[]): SummaryStatus {
  return statuses.reduce((current, next) =>
    SUMMARY_SEVERITY_RANK[next] > SUMMARY_SEVERITY_RANK[current]
      ? next
      : current,
  );
}

export function buildTrendBySeverity(severity: SummaryStatus): SummaryTrend {
  if (severity === 'critical') {
    return 'degrading';
  }

  if (severity === 'warning') {
    return 'watch';
  }

  return 'stable';
}

export function buildImpactLevelBySeverity(
  severity: SummaryStatus,
): SummaryImpactLevel {
  if (severity === 'critical') {
    return 'high';
  }

  if (severity === 'warning') {
    return 'medium';
  }

  return 'low';
}

export function buildEtaBySeverity(severity: SummaryStatus): string {
  if (severity === 'critical') {
    return '30 分钟内';
  }

  if (severity === 'warning') {
    return '今日内';
  }

  return '持续观察';
}

export function sortSummaryHighlights(
  highlights: SummaryHighlight[],
): SummaryHighlight[] {
  return [...highlights].sort(
    (left, right) =>
      SUMMARY_SEVERITY_RANK[right.severity] -
        SUMMARY_SEVERITY_RANK[left.severity] ||
      right.priority - left.priority ||
      left.domain.localeCompare(right.domain) ||
      left.code.localeCompare(right.code),
  );
}
