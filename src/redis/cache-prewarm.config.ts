import type {
  CachePrewarmCategoryConfigInput,
  CachePrewarmProvider,
} from './cache-prewarm.config.types';
import { cachePrewarmCategoryConfigProviders } from './cache-prewarm.providers';
import type { CachePrewarmCategoryConfig } from './cache-prewarm.types';

export function buildCachePrewarmCategoryConfigs<
  TInput extends object,
  TConfig extends CachePrewarmCategoryConfig,
>(
  providers: readonly CachePrewarmProvider<TInput, TConfig>[],
  input: TInput,
): readonly TConfig[] {
  return providers.map((provider) => provider(input));
}

export function createCachePrewarmCategoryConfigs(
  input: CachePrewarmCategoryConfigInput,
): readonly CachePrewarmCategoryConfig[] {
  return buildCachePrewarmCategoryConfigs(
    cachePrewarmCategoryConfigProviders,
    input,
  );
}
