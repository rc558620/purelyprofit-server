/**
 * 日期容错工具：统一处理「Redis / JSON 反序列化后日期字段回读为字符串」的场景。
 *
 * 背景（真实事故）：业务数据写入 Redis 走 JSON.stringify，回读时 Date 字段变成
 * ISO 字符串，但 TS 类型仍声明为 Date（强类型是"假"的），消费处直接调
 * `.getTime()` 会抛 `xxx.getTime is not a function`（首页看板曾因此 500）。
 *
 * 使用约定：凡数据可能来自缓存（RefreshableCacheService / RedisService.getJson），
 * 涉及日期比较或格式化时一律先经本文件转换，禁止直接调用 Date 实例方法。
 */

/** 日期 → 毫秒时间戳；兼容 Date / ISO 字符串 / 数字时间戳 */
export function toTimestamp(value: Date | string | number): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  return new Date(value).getTime();
}

/**
 * 日期 → 毫秒时间戳，空值或解析失败时回落兜底值。
 *
 * `toTimestamp` 对非法输入返回 NaN，会污染排序与比较；涉及"可能缺失"的
 * 缓存字段（如可空的 expireAt）时改用本函数。
 */
export function resolveTimestamp(
  value: Date | string | number | null | undefined,
  fallback: number,
): number {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const timestamp = toTimestamp(value);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

/** 日期 → ISO 字符串；空值或解析失败时返回 null（用于响应 DTO 的时间字段） */
export function toIsoStringOrNull(
  value: Date | string | number | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}
