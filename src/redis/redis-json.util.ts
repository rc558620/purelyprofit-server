/**
 * 安全的 JSON 序列化，处理 BigInt 和 Prisma.Decimal 类型：
 * - BigInt → Number（若在安全整数范围内）否则转字符串
 * - Prisma.Decimal（duck-typing：有 toNumber 且非 Date/Array）→ Number
 * - Date → 保持原生行为（ISO 字符串）
 *
 * 采用两阶段策略：先深度遍历将 BigInt / Decimal 转为原生类型，
 * 再用原生 JSON.stringify 序列化。这是因为 JSON.stringify 的 replacer
 * 在遇到有 toJSON() 的对象时会先调用 toJSON()，导致无法在 replacer
 * 中拦截 Prisma.Decimal 转为 number。
 */
export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

export function normalizeForJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  }

  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    typeof (value as Record<string, unknown>).toNumber === 'function'
  ) {
    // Prisma.Decimal 或类似 Decimal 类型 → number
    try {
      return (value as { toNumber: () => number }).toNumber();
    } catch {
      return (value as { toString: () => string }).toString();
    }
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForJson);
  }

  // Date 对象必须在通用 object 分支之前处理：
  // Object.entries(new Date()) 返回 []，会把 Date 序列化为空对象 {}，导致反序列化后 NaN
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = normalizeForJson(v);
    }
    return result;
  }

  return value;
}
