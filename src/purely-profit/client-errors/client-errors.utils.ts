/** 单条 details 允许的顶层 key 数量上限（防止恶意/异常 payload 撑爆日志） */
const MAX_DETAILS_KEYS = 20;
/** 嵌套对象每层允许的 key 数量上限 */
const MAX_NESTED_DETAILS_KEYS = 8;
/** details 递归脱敏的最大深度 */
const MAX_DETAILS_DEPTH = 3;
/** details 内单个字符串值的最大长度 */
const MAX_DETAIL_STRING_LENGTH = 600;
/** details 内数组的最大元素数量 */
const MAX_DETAIL_ARRAY_LENGTH = 10;
/** details key 的最大长度 */
const MAX_DETAIL_KEY_LENGTH = 60;

/**
 * 敏感字段 key 匹配模式：命中后值统一替换为 [redacted]。
 *
 * details 是前端任意透传字段，是最容易误塞 token / 验证码 / 手机号的地方。
 * 该模式宁可误伤（多脱敏）也不放过，因为过度脱敏的代价远小于明文泄漏。
 */
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|pwd|secret|token|authorization|cookie|session|phone|mobile|tel|idcard|idno|bankcard|cardno|captcha|verifycode|smscode|accesskey|privatekey|apikey)/i;

const REDACTED_VALUE = '[redacted]';

export const truncateText = (
  value: string | undefined,
  maxLength: number,
): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return undefined;
  }

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...<truncated>`;
};

export const maskPhone = (phone: string | undefined): string | undefined => {
  const normalizedPhone = phone?.trim();
  if (!normalizedPhone) {
    return undefined;
  }

  const digitsOnlyPhone = normalizedPhone.replace(/\D/g, '');
  // 位数不足时无法给出有意义的掩码，直接丢弃而不是原样返回：
  // 脱敏函数不允许存在「返回原文」的分支。
  if (digitsOnlyPhone.length < 7) {
    return undefined;
  }

  const prefix = digitsOnlyPhone.slice(0, 3);
  const suffix = digitsOnlyPhone.slice(-4);
  return `${prefix}****${suffix}`;
};

export const readStringDetail = (
  value: unknown,
  maxLength: number,
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  return truncateText(value, maxLength) ?? null;
};

export const readNumberDetail = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
};

export const extractStackHead = (stack: string | undefined): string | null => {
  const stackHead = stack?.split('\n')[0];
  return truncateText(stackHead, 200) ?? null;
};

/**
 * 对前端透传的 details 做脱敏 + 限流（数量/深度/长度）。
 *
 * 返回 null 表示 details 不可用（undefined / 非对象 / 数组）。
 */
export const sanitizeDetails = (
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | null => {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details).slice(
    0,
    MAX_DETAILS_KEYS,
  )) {
    const safeKey = truncateText(key, MAX_DETAIL_KEY_LENGTH) ?? 'unknown';
    sanitized[safeKey] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED_VALUE
      : sanitizeDetailValue(value, 1);
  }

  return sanitized;
};

const sanitizeDetailValue = (value: unknown, depth: number): unknown => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return truncateText(value, MAX_DETAIL_STRING_LENGTH) ?? null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (depth >= MAX_DETAILS_DEPTH) {
    return '[max-depth-reached]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DETAIL_ARRAY_LENGTH)
      .map((item) => sanitizeDetailValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const nested: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    ).slice(0, MAX_NESTED_DETAILS_KEYS)) {
      const safeKey = truncateText(key, MAX_DETAIL_KEY_LENGTH) ?? 'unknown';
      nested[safeKey] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED_VALUE
        : sanitizeDetailValue(nestedValue, depth + 1);
    }

    return nested;
  }

  return '[unsupported-value-type]';
};

export const extractDetailsKeys = (
  details: Record<string, unknown> | null,
): string[] | null => {
  if (!details) {
    return null;
  }

  const keys = Object.keys(details)
    .slice(0, MAX_DETAILS_KEYS)
    .map((key) => truncateText(key, MAX_DETAIL_KEY_LENGTH))
    .filter((key): key is string => Boolean(key));

  return keys.length > 0 ? keys : null;
};

export const serializeDetails = (
  details: Record<string, unknown> | null,
  detailsMaxLength: number,
): string | undefined => {
  if (!details) {
    return undefined;
  }

  try {
    return truncateText(JSON.stringify(details), detailsMaxLength);
  } catch {
    // 包含循环引用或不可序列化值，返回占位标记
    return '[unserializable-details]';
  }
};
