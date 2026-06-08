import type {
  CachePrewarmCategoryConfigInput,
  CachePrewarmCategoryConfigProvider,
  CachePrewarmFinanceConfigInput,
  CachePrewarmProfitReadConfigInput,
  CachePrewarmProvider,
} from './cache-prewarm.config.types';
import { financeCachePrewarmCategoryConfigProviders } from './cache-prewarm-finance.config';
import { profitReadCachePrewarmCategoryConfigProviders } from './cache-prewarm-profit-read.config';

function adaptCachePrewarmProvider<
  TInput extends object,
  TWideInput extends TInput,
>(
  provider: CachePrewarmProvider<TInput>,
): CachePrewarmCategoryConfigProvider<TWideInput> {
  return (input: TWideInput) => provider(input);
}

export const cachePrewarmCategoryConfigProviders: readonly CachePrewarmCategoryConfigProvider<CachePrewarmCategoryConfigInput>[] =
  [
    ...profitReadCachePrewarmCategoryConfigProviders.map((provider) =>
      adaptCachePrewarmProvider<
        CachePrewarmProfitReadConfigInput,
        CachePrewarmCategoryConfigInput
      >(provider),
    ),
    ...financeCachePrewarmCategoryConfigProviders.map((provider) =>
      adaptCachePrewarmProvider<
        CachePrewarmFinanceConfigInput,
        CachePrewarmCategoryConfigInput
      >(provider),
    ),
  ];
