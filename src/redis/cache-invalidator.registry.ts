export type CacheInvalidatorProvider<
  TInput extends object,
  TRegistrySlice extends object,
> = (input: TInput) => TRegistrySlice;

export function buildCacheInvalidatorRegistry<
  TInput extends object,
  TRegistry extends object,
>(
  providers: readonly CacheInvalidatorProvider<TInput, Partial<TRegistry>>[],
  input: TInput,
): TRegistry {
  return providers.reduce<TRegistry>(
    (registry, provider) => Object.assign(registry, provider(input)),
    {} as TRegistry,
  );
}
