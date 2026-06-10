import Decimal from 'decimal.js';

/**
 * 分转元
 */
export function convertFenToYuan(amountFen: number): number {
  return new Decimal(amountFen).div(100).toDecimalPlaces(2).toNumber();
}

/**
 * 元转分
 */
export function convertYuanToFen(amountYuan: number): number {
  return new Decimal(amountYuan).mul(100).toDecimalPlaces(0).toNumber();
}

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
