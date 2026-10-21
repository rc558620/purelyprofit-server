import { toCacheSegment } from '../../../redis/cache-keys.shared';

/**
 * 交班页（GET /handover/page）缓存键。
 *
 * ─── 为什么必须带 userId ───────────────────────────────────────────
 * 交班页内容随身份变化：收银员只看自己的班次，老板/店长看全店班次，
 * 且响应里的 canOperate / operationBlockedReason 本身就是权限判定结果。
 * 因此缓存维度 = 门店 + 用户 + 请求的班次 + 交班人姓名，不能只按门店缓存。
 *
 * ─── 为什么用「有界陈旧」缓存 ──────────────────────────────────────
 * 一次交班页 = 约 50 次 DB 往返（Prisma 深层嵌套 select 会展开成 N 条 SQL），
 * 本地小数据量实测 219ms。页面营收/收款属于允许短暂滞后的概览数据，
 * 与 RefreshableCacheService 的定位一致（余额/库存等强一致读数不适用）。
 */
export function buildHandoverPageCacheKey(params: {
  storeId: number;
  userId: number;
  shiftType?: string;
  operatorName?: string;
}): string {
  const { storeId, userId, shiftType, operatorName } = params;

  return [
    'profit:handover:page',
    `store:${storeId}`,
    `user:${userId}`,
    `shift:${toCacheSegment(shiftType ?? 'auto')}`,
    `op:${toCacheSegment(operatorName ?? 'na')}`,
  ].join(':');
}

/**
 * 按门店整体失效：交班确认/完成/取消会改变班次交班状态，
 * 页面所有用户（含同店其他账号）的缓存都应失效，故按门店粒度删。
 */
export function buildHandoverPagePattern(storeId: number): string {
  return `profit:handover:page:store:${storeId}:*`;
}
