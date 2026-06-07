import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

export type PrismaDecimalLike = Prisma.Decimal | Decimal | number | string;

export function toPrismaDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

export function roundMoneyValue(value: PrismaDecimalLike): number {
  return new Decimal(value.toString())
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function toMoneyNumber(value: PrismaDecimalLike): number {
  return roundMoneyValue(new Decimal(value.toString()));
}

export function addMoneyValues(left: number, right: number): number {
  return roundMoneyValue(new Decimal(left).plus(right));
}

export function subtractMoneyValues(left: number, right: number): number {
  return roundMoneyValue(new Decimal(left).minus(right));
}

export function calcPercent(amount: number, total: number): number {
  if (isZeroValue(total)) {
    return 0;
  }

  return new Decimal(amount)
    .div(total)
    .mul(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function isZeroValue(value: number): boolean {
  return new Decimal(value).isZero();
}
