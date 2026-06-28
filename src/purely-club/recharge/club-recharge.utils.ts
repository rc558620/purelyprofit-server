// 从 shared 重新导出 Money 类，保持现有导入路径向后兼容
// 注意：convertFenToYuan / convertYuanToFen 已废弃，请使用 Money 类
export { Money } from '../../shared/money.utils';

/**
 * 转换为正整数
 */
export function toPositiveInteger(value: unknown): number | null {
  const normalized = toNonNegativeInteger(value);
  if (normalized === null || normalized <= 0) {
    return null;
  }
  return normalized;
}

/**
 * 转换为非负整数
 */
export function toNonNegativeInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? Math.round(value) : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed);
    }
  }

  return null;
}

/**
 * 转换为非负数
 */
export function toNonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}
