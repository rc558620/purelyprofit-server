import { Logger } from '@nestjs/common';
import type {
  CachePrewarmCategory,
  CachePrewarmCategoryResult,
  CachePrewarmSlowKeySample,
} from './cache-prewarm.types';
import { getCachePrewarmFailedSampleErrorMeta } from './cache-prewarm.error';
import { buildCachePrewarmFailedLogPayload } from './cache-prewarm.log';
import {
  buildCachePrewarmDurationDistribution,
  buildEmptyCachePrewarmCategoryResult,
  selectTopSlowCachePrewarmSamples,
} from './cache-prewarm.utils';

const logger = new Logger('CachePrewarmExecutor');

export async function prewarmCacheCategory<TParsed>(
  category: CachePrewarmCategory,
  cacheKeys: string[],
  parse: (cacheKey: string) => TParsed | null,
  refresh: (parsed: TParsed) => Promise<unknown>,
  options: { concurrency: number },
): Promise<CachePrewarmCategoryResult> {
  const durations: number[] = [];
  const slowKeySamples: CachePrewarmSlowKeySample[] = [];
  const result: CachePrewarmCategoryResult =
    buildEmptyCachePrewarmCategoryResult(cacheKeys.length);
  const concurrency = Math.max(1, options.concurrency);

  for (
    let startIndex = 0;
    startIndex < cacheKeys.length;
    startIndex += concurrency
  ) {
    const batch = cacheKeys.slice(startIndex, startIndex + concurrency);

    await Promise.all(
      batch.map(async (cacheKey) => {
        const parsed = parse(cacheKey);
        if (!parsed) {
          result.invalidCount += 1;
          return;
        }

        const startedAt = Date.now();
        try {
          await refresh(parsed);
          result.refreshedCount += 1;
          const durationMs = Date.now() - startedAt;
          durations.push(durationMs);
          slowKeySamples.push({
            category,
            cacheKey,
            durationMs,
            status: 'refreshed',
            errorTag: null,
            failedReason: null,
          });
        } catch (error: unknown) {
          result.failedCount += 1;
          const durationMs = Date.now() - startedAt;
          const errorMeta = getCachePrewarmFailedSampleErrorMeta(error);
          const failedSample: CachePrewarmSlowKeySample = {
            category,
            cacheKey,
            durationMs,
            status: 'failed',
            errorTag: errorMeta.errorTag,
            failedReason: errorMeta.failedReason,
          };
          const failedLogPayload = buildCachePrewarmFailedLogPayload({
            durationMs,
            category,
            cacheKey,
            errorTag: errorMeta.errorTag,
            failedReason: errorMeta.failedReason,
          });
          durations.push(durationMs);
          slowKeySamples.push(failedSample);
          logger.warn('[cache-prewarm] refresh failed', failedLogPayload);
        }
      }),
    );
  }

  // hitCount equals the number of scanned keys (cacheKeys.length).
  // skippedCount represents keys that were scanned but not processed
  // (refreshed/invalid/failed) — currently always 0 since every key is
  // either parsed+refreshed, invalid, or failed.
  result.skippedCount = Math.max(
    0,
    result.hitCount -
      result.refreshedCount -
      result.invalidCount -
      result.failedCount,
  );
  result.durationDistribution =
    buildCachePrewarmDurationDistribution(durations);
  result.slowKeySamples = selectTopSlowCachePrewarmSamples(slowKeySamples);

  return result;
}
