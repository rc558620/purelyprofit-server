import { toCacheSegment } from '../cache-keys.shared';

/**
 * 空间管理读侧缓存键（看板 + 空间列表）。
 *
 * 与 sales-stats 同策略：短 TTL + 后台刷新 + 写路径按 pattern 失效，
 * 属于「有界陈旧」缓存，最强一致读数不要走这里。
 */

type SpacesListCacheQuery = {
  type?: string;
  zone?: string;
};

/** 空间看板：单门店一份，与查询参数无关（看板不接收筛选参数）。 */
export function buildSpacesDashboardCacheKey(storeId: number): string {
  return `profit:spaces:dashboard:store:${storeId}`;
}

export function buildSpacesDashboardPattern(storeId: number): string {
  return `profit:spaces:dashboard:store:${storeId}`;
}

/**
 * 空间看板「统计汇总」轻量缓存：只服务首屏统计条。
 *
 * 独立分键的原因：miss 时只需要统计（空间数 + 今日结账/营业额），
 * 不需要为每个空间组装主预约/未来预约摘要。
 * 失效与主看板一起精确删除（不用 `store:${id}*` 通配，避免误删 store:180）。
 */
export function buildSpacesDashboardStatsCacheKey(storeId: number): string {
  return `${buildSpacesDashboardCacheKey(storeId)}:stats`;
}

/**
 * 空间列表：按门店 + 结构筛选（type/zone）分键。
 * status 是运行态派生值，由读侧在缓存外过滤，不参与分键，
 * 避免同一门店按 status 缓存多份全量结果、写失效时一并失效。
 */
export function buildSpacesListCacheKey(
  storeId: number,
  query: SpacesListCacheQuery,
): string {
  return [
    'profit:spaces:list',
    `store:${storeId}`,
    `type:${toCacheSegment(query.type)}`,
    `zone:${toCacheSegment(query.zone)}`,
  ].join(':');
}

export function buildSpacesListPattern(storeId: number): string {
  return `profit:spaces:list:store:${storeId}:*`;
}

/**
 * 门店维度会话快照（收银台轮询口）的筛选参数。
 *
 * 与空间列表同策略：status 已由调用方归一化，仍参与分键（快照默认 active，
 * 但兼容显式查 settled 历史），其余为搜索/区间筛选项。
 */
type SpaceSessionsSnapshotCacheQuery = {
  status?: string;
  keyword?: string;
  guestName?: string;
  guestPhone?: string;
  spaceName?: string;
  rangeStartDate?: number;
  rangeEndDate?: number;
};

/**
 * 门店会话快照缓存键。
 *
 * 该接口是收银台轮询的最高频读取口，单次要带出全量 items / renewRecords，
 * 命中缓存后从「1 条主查询 + 2 条关系查询 + 数千行明细」降为 1 次 Redis GET。
 */
export function buildSpaceSessionsSnapshotCacheKey(
  storeId: number,
  query: SpaceSessionsSnapshotCacheQuery,
): string {
  return [
    'profit:spaces:sessions-snapshot',
    `store:${storeId}`,
    `status:${toCacheSegment(query.status)}`,
    `keyword:${toCacheSegment(query.keyword)}`,
    `guestName:${toCacheSegment(query.guestName)}`,
    `guestPhone:${toCacheSegment(query.guestPhone)}`,
    `spaceName:${toCacheSegment(query.spaceName)}`,
    `start:${toCacheSegment(query.rangeStartDate)}`,
    `end:${toCacheSegment(query.rangeEndDate)}`,
  ].join(':');
}

export function buildSpaceSessionsSnapshotPattern(storeId: number): string {
  return `profit:spaces:sessions-snapshot:store:${storeId}:*`;
}

/**
 * 空间类型列表：单门店一份，与查询参数无关（列表仅按 storeId 过滤）。
 *
 * 空间类型是低频变更的门店运营配置（仅主账号可增改删），
 * 采用短 TTL + 写路径主动失效，与看板同策略。
 */
export function buildSpaceTypesCacheKey(storeId: number): string {
  return `profit:space-types:store:${storeId}`;
}

export function buildSpaceTypesPattern(storeId: number): string {
  return `profit:space-types:store:${storeId}`;
}

/** 空间区域列表：与空间类型同源同策略（门店级低频运营配置）。 */
export function buildSpaceZonesCacheKey(storeId: number): string {
  return `profit:space-zones:store:${storeId}`;
}

export function buildSpaceZonesPattern(storeId: number): string {
  return `profit:space-zones:store:${storeId}`;
}

/**
 * 二维码图片产物的版本维度。
 *
 * `version` 必须是 tokenHash（sha256 摘要）：轮换后必然变化，因此不可能
 * 出现「轮换后仍返回旧图」；同时摘要不可逆，键里不出现任何明文 token。
 */
type SpaceQrImageCacheVariant = {
  version: string;
  /** 出图宽度（px）：弹窗图 512、下载图 1024，尺寸不同即产物不同 */
  width: number;
  /** 静区宽度（模块数）：弹窗图 0、下载图 2 */
  margin: number;
};

/**
 * 空间二维码图片缓存键。
 *
 * 出图是纯 CPU 渲染（qrcode 编码 + PNG 压缩），批量生成海报时同一空间
 * 会被反复渲染；缓存只保存图片产物本身，不含 token 明文。
 */
export function buildSpaceQrImageCacheKey(
  spaceId: number,
  variant: SpaceQrImageCacheVariant,
): string {
  return [
    'profit:spaces:qr-image',
    `space:${spaceId}`,
    `v:${variant.version}`,
    `w:${variant.width}`,
    `m:${variant.margin}`,
  ].join(':');
}

/** 空间维度失效：空间被删除时清理该空间全部尺寸的图片产物 */
export function buildSpaceQrImagePattern(spaceId: number): string {
  return `profit:spaces:qr-image:space:${spaceId}:*`;
}

/**
 * 实时结账预览的缓存分桶版本。
 *
 * ⚠️ 不能用自然分钟（`floor(Date.now() / 60000)`）：预览金额按「已过分钟数」跳变
 * （`calcDurationMinutes` 向上取整 + 台位费按分钟计价），`startTime` 非整分时
 * 同一自然分钟内 elapsed 会跨过整分边界，导致同一键内金额跳变。
 *
 * 这里用「elapsed 分钟桶」：`bucket = floor((now - startTime) / 60000)`，
 * 桶内结算分钟数数学恒定（详见 `resolveLivePreviewCheckoutAt`），
 * 因此同一 bucket 的键可以安全复用同一份金额。
 */
export function buildSpaceLivePreviewCacheKey(
  storeId: number,
  sessionId: number,
  bucket: number,
): string {
  return [
    'profit:spaces:live-preview',
    `store:${storeId}`,
    `session:${sessionId}`,
    `bucket:${bucket}`,
  ].join(':');
}

/**
 * 门店维度失效：开台 / 续费 / 加单 / 换房 / 结账后，
 * 该门店所有会话的预览金额都可能变化，按 store 段整片清理。
 */
export function buildSpaceLivePreviewPattern(storeId: number): string {
  return `profit:spaces:live-preview:store:${storeId}:*`;
}
