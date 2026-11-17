import { toCacheSegment } from '../../../redis/cache-keys.shared';

/**
 * 交班页（GET /handover/page）缓存键。
 *
 * ─── 为什么必须带 userId（不能直接去掉）─────────────────────────────
 * 交班页响应里混着两类字段：
 * 1. 门店级指标：revenueSummary / paymentItems / orderItems；
 * 2. 身份相关结果：canOperate / operationBlockedReason / shiftInfo.operatorName /
 *    receiverName / shiftInfo.operatorAvatar。
 * 第 2 类由 resolvePageShiftContext 按「当前登录账号 + 其门店成员身份」解析得出
 * （收银员只看本人班次，老板/店长看全店班次）。去掉 userId 会让 A 账号读到
 * B 账号的 canOperate，等于把交班写权限的判定结果跨账号泄露。
 *
 * ─── 为什么没有拆成「门店指标层 + 身份裁决层」两层缓存 ────────────────
 * 已评审过拆分方案，结论是当前不拆，理由按影响从大到小：
 * 1. 指标并不是「按门店」可复用的：统计区间由 resolvePageShiftRange 依赖
 *    shiftRecord / operatorName / shiftType / displayTargetEmployeeId 解析而来，
 *    同店的不同账号常常落在不同 shiftRange 上，拆层后命中率提升有限；
 * 2. 两侧同源：canOperate 与指标共用同一个 shiftRecord。分成两份缓存后一旦
 *    出现「身份层旧、指标层新」的时间差，用户会看到指标与可操作状态互相矛盾，
 *    比整页轻微陈旧更危险；
 * 3. 失效面翻倍：写操作（确认/完成/取消/创建）现在按门店一条 pattern 删净，
 *    拆层后要同时覆盖两层，漏删任一层都会让 canOperate 长时间卡在旧值；
 * 4. 收益边界：一次交班页约 50 次 DB 往返（Prisma 深层嵌套 select 展开为 N 条
 *    SQL），本地小数据量实测 219ms。同店多账号同时看同一班次是低频场景，
 *    为它引入两段缓存 + 两段失效不划算。
 *
 * ─── 缓存性质（有界陈旧）────────────────────────────────────────────
 * TTL 20s（见 handover.service.ts），热点页在 refreshAfterMs=5s 后由后台刷新自愈，
 * 实际陈旧窗口约 5s；页面营收/收款属于允许短暂滞后的概览数据，
 * 与 RefreshableCacheService 的定位一致（余额/库存等强一致读数不得走这里）。
 *
 * ─── 什么情况下值得重新评估拆层 ───────────────────────────────────
 * 出现「同店 3 个以上账号高频轮询同一班次、且冷启动查询量成为 P95 瓶颈」的
 * 实测数据时再拆；届时必须保证：身份层 TTL 明显短于指标层，且失效同时覆盖两层。
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
 *
 * ⚠️ 若将来按上面的评估真的拆成两层缓存，本 pattern 必须同时命中两层
 * （当前 key 前缀已按 `profit:handover:page:store:<storeId>:` 收敛，新增层
 * 只要继续挂在该前缀下即可被一次 delByPattern 覆盖）。
 */
export function buildHandoverPagePattern(storeId: number): string {
  return `profit:handover:page:store:${storeId}:*`;
}
