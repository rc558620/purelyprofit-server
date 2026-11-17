/**
 * 入参 / 落库字段的文本规范化。
 *
 * 三组语义必须区分清楚，不要互相替代：
 * - `toOptional*`：空字符串归一为 `undefined`，用于「缺省即不更新」；
 * - `toNullable*`：空字符串归一为 `null`，用于「显式清空字段」；
 * - `*MediaText`：额外过滤 `blob:` 本地临时地址，避免落库成不可用的图片路径。
 */

export function toTimestampMs(value: Date): number {
  return value.getTime();
}

export function toOptionalTimestampMs(value?: Date | null): number | undefined {
  return value ? value.getTime() : undefined;
}

export function toOptionalText(value?: string | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === '' ? undefined : trimmedValue;
}

export function toOptionalMediaText(value?: string | null): string | undefined {
  const normalizedValue = toOptionalText(value);

  if (!normalizedValue || normalizedValue.startsWith('blob:')) {
    return undefined;
  }

  return normalizedValue;
}

export function toNullableText(value?: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === '' ? null : trimmedValue;
}

export function toNullableMediaText(value?: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = toOptionalMediaText(value);
  return normalizedValue ?? null;
}
