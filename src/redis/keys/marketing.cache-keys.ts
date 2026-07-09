export function buildMarketingOverviewCacheKey(storeId: number): string {
  return `profit:marketing:overview:store:${storeId}`;
}

export function buildMarketingOverviewPattern(storeId: number): string {
  return `profit:marketing:overview:store:${storeId}:*`;
}

export function buildMarketingOverviewAllPattern(): string {
  return 'profit:marketing:overview:store:*';
}

export function parseMarketingOverviewCacheKey(cacheKey: string): {
  storeId: number;
} | null {
  const match = /^profit:marketing:overview:store:(\d+)$/.exec(cacheKey);
  if (!match) {
    return null;
  }

  return {
    storeId: Number(match[1]),
  };
}

export function buildMarketingPromotionsListCacheKey(
  storeId: number,
  status: string,
  page: number,
  pageSize: number,
  enabled?: boolean,
): string {
  const enabledPart = enabled !== undefined ? `:enabled:${enabled}` : '';
  return `profit:marketing:promotions:list:store:${storeId}:status:${status}:page:${page}:pageSize:${pageSize}${enabledPart}`;
}

export function buildMarketingPromotionsListPattern(storeId: number): string {
  return `profit:marketing:promotions:list:store:${storeId}:*`;
}

export function buildMarketingCustomersListCacheKey(
  storeId: number,
  status: string,
  tier: string,
  keyword: string,
  page: number,
  pageSize: number,
  name: string = '',
  phone: string = '',
): string {
  return [
    'profit:marketing:customers:list',
    `store:${storeId}`,
    `status:${status}`,
    `tier:${tier}`,
    `keyword:${encodeURIComponent(keyword || 'na')}`,
    `name:${encodeURIComponent(name || 'na')}`,
    `phone:${encodeURIComponent(phone || 'na')}`,
    `page:${page}`,
    `pageSize:${pageSize}`,
  ].join(':');
}

export function buildMarketingCustomersListPattern(storeId: number): string {
  return `profit:marketing:customers:list:store:${storeId}:*`;
}

// F8: 顾客详情缓存 key
export function buildMarketingCustomerDetailCacheKey(
  storeId: number,
  customerId: number,
): string {
  return `profit:marketing:customer:detail:store:${storeId}:id:${customerId}`;
}

export function buildMarketingCustomerDetailPattern(storeId: number): string {
  return `profit:marketing:customer:detail:store:${storeId}:*`;
}
