export interface RefreshableCachePayload<T> {
  generatedAt: number;
  refreshAt: number;
  data: T;
}

export interface RefreshableCacheLoadOptions<T> {
  cacheKey: string;
  taskKey: string;
  ttlSeconds: number;
  refreshAfterMs: number;
  loadValue: () => Promise<T>;
  refreshValue?: () => Promise<T>;
}
