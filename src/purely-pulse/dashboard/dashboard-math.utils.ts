import Decimal from 'decimal.js';

export function subtractMoney(minuend: number, subtrahend: number): number {
  return new Decimal(minuend).minus(subtrahend).toNumber();
}

export function calculatePercentChange(
  current: number,
  previous: number,
  options?: {
    fallback?: number | null;
    absoluteBase?: boolean;
    precision?: number;
  },
): number | null {
  const fallback = options?.fallback ?? null;
  const precision = options?.precision ?? 1;
  const base = options?.absoluteBase ? Math.abs(previous) : previous;

  if (base === 0) {
    return fallback;
  }

  return new Decimal(current - previous)
    .div(base)
    .mul(100)
    .toDecimalPlaces(precision)
    .toNumber();
}

export function calculateRatioPercent(
  numerator: number,
  denominator: number,
  precision = 2,
): number {
  if (denominator <= 0) {
    return 0;
  }

  return new Decimal(numerator)
    .div(denominator)
    .mul(100)
    .toDecimalPlaces(precision)
    .toNumber();
}

export function convertFenToYuan(amountFen: number): number {
  return new Decimal(amountFen).div(100).toDecimalPlaces(2).toNumber();
}
