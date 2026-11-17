import {
  buildClubMemberSnapshotCacheKey,
  buildClubPromotionListCacheKey,
  buildClubPromotionsCacheKey,
  buildClubProductsVersionCacheKey,
} from '../../redis/keys/club-cache-keys';
import { buildStoreProfileMetadataCacheKey } from '../../redis/keys/stores.cache-keys';
import type { ClubCurrentContext } from '../stores/club-stores.types';

/**
 * 首页链路可预取的 Redis key 清单（一次 MGET 全部取回）。
 *
 * 入选标准：**只依赖已解析好的当前上下文**（storeId / clubUserId），不需要
 * 等到任何前序分支的结果。命中后各读点直接复用，未命中则回退原有读取。
 *
 * | key | 读点 | 约束 |
 * | --- | --- | --- |
 * | 门店扩展字段 | StoresProfileService.readStoreProfileMetadataCached | 7 天 TTL |
 * | 会员快照 | ClubMemberProfileService.getSnapshotByStoreIdentity | 15s / 空结果 5s |
 * | 活动展示列表 | ClubPromotionsService.loadActivePromotions | 活动边界 TTL |
 * | 活动定价投影 | ClubPromotionRepository.loadActivePromotions | 活动边界 TTL |
 * | 商品版本 | ClubProductCacheService.resolveVersion | 10s |
 *
 * 刻意**不**预取的两跳：
 *  - 商品列表 key 内嵌商品版本，而版本本身来自 Redis（或一次聚合回源），
 *    属于天然第二跳；
 *  - 首单资格 key 需要先由会员快照解析出 customerId，同样只能在第二跳之后
 *    才能算出，且不应为此在预取层再查一次 DB。
 *
 * TTL 语义不受预取影响：本容器只读，不写回、不改变任何 key 的过期时间。
 */
export function buildClubHomePrefetchKeys(
  currentContext: ClubCurrentContext,
): string[] {
  const storeId = currentContext.store.id;

  return [
    buildStoreProfileMetadataCacheKey(storeId),
    buildClubMemberSnapshotCacheKey(storeId, currentContext.user.id),
    buildClubPromotionListCacheKey(storeId),
    buildClubPromotionsCacheKey(storeId),
    buildClubProductsVersionCacheKey(storeId),
  ];
}
