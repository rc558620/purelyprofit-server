import type { TransformFnParams } from 'class-transformer';

export const MARKETING_PRODUCT_IMAGE_MAX_LENGTH = 300000;

/** 严格整数转换：仅接受干净整数串，拒绝浮点（B-4 fix） */
export function transformRequiredInt({
  value,
}: TransformFnParams): number | string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
    return value; // 非干净整数串，留给 @IsInt 报错
  }
  return String(value);
}

/** 可清空整数转换：null/'' → null（B-1 fix，清空语义） */
export function transformNullableInt({
  value,
}: TransformFnParams): number | null | string | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
    return value;
  }
  return String(value);
}

/** 可空元金额转换：null/'' → null（清空语义），number 原样透传 */
export function transformNullableYuan({
  value,
}: TransformFnParams): number | null | string | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return String(value);
}

/** B-3 fix: 字符串 trim，让 MinLength/MaxLength 在 trim 后校验 */
export function trimString({ value }: TransformFnParams): string | undefined {
  if (typeof value === 'string') return value.trim();
  return value;
}
