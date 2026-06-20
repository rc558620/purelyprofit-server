export const DAY_MS = 86_400_000;
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const SUMMARY_LIMIT = 5;
export const NOTIFICATIONS_READ_KEY_PREFIX = 'notifications:read:';
/** 已读标记保留 30 天，过期后自动清理，避免孤立 key 永久累积 */
export const NOTIFICATIONS_READ_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LOW_STOCK_SOURCE_LIMIT = 50;
export const SOURCE_LIMIT = 20;
/** 通知内容缓存 60 秒，避免每次请求全量查库 */
export const NOTIFICATIONS_ITEMS_CACHE_TTL_SECONDS = 60;
