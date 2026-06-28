import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

export type PrismaDecimalLike = Prisma.Decimal | Decimal | number | string;

export function toPrismaDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

export function calcPercent(amount: number, total: number): number {
  if (new Decimal(total).isZero()) {
    return 0;
  }

  return new Decimal(amount)
    .div(total)
    .mul(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}
