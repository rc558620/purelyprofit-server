import type { SummaryHighlight } from './metrics-summary.protocol';
import type { SummaryBuildContext } from './runtime-metrics.summary-context.types';
import { buildCachePrewarmSummaryHighlights } from './runtime-metrics.summary-highlights-cache-prewarm';
import { buildHttpSummaryHighlights } from './runtime-metrics.summary-highlights-http';
import { buildProcessSummaryHighlights } from './runtime-metrics.summary-highlights-process';
import { buildRedisSummaryHighlights } from './runtime-metrics.summary-highlights-redis';
import { buildSqlSummaryHighlights } from './runtime-metrics.summary-highlights-sql';
import { sortSummaryHighlights } from './runtime-metrics.summary-helpers';

export function buildSummaryHighlights(
  context: SummaryBuildContext,
): SummaryHighlight[] {
  return sortSummaryHighlights([
    ...buildProcessSummaryHighlights(context),
    ...buildHttpSummaryHighlights(context),
    ...buildSqlSummaryHighlights(context),
    ...buildRedisSummaryHighlights(context),
    ...buildCachePrewarmSummaryHighlights(context),
  ]);
}
