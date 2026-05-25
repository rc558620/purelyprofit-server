import { Prisma } from '@prisma/client';
import type {
  MarketingCustomerListQueryInput,
  MarketingPromotionListQueryInput,
  MarketingRechargeListQueryInput,
} from './marketing.types';

export function buildCustomerWhere(
  input: MarketingCustomerListQueryInput,
): Prisma.MarketingCustomerWhereInput {
  const now = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * 86400_000);
  const cutoff90 = new Date(now.getTime() - 90 * 86400_000);
  const where: Prisma.MarketingCustomerWhereInput = {
    storeId: input.storeId,
  };

  if (input.status === 'active') {
    where.lastVisitAt = { gte: cutoff30 };
  } else if (input.status === 'dormant') {
    where.lastVisitAt = { gte: cutoff90, lt: cutoff30 };
  } else if (input.status === 'lost') {
    where.OR = [{ lastVisitAt: { lt: cutoff90 } }, { lastVisitAt: null }];
  }

  if (input.tier) {
    (
      where as Prisma.MarketingCustomerWhereInput & {
        tier?: MarketingCustomerListQueryInput['tier'];
      }
    ).tier = input.tier;
  }

  if (input.keyword) {
    where.OR = [
      ...(Array.isArray(where.OR) ? where.OR : []),
      { name: { contains: input.keyword, mode: 'insensitive' } },
      { phone: { contains: input.keyword } },
    ];
  }

  return where;
}

export function buildRechargeCountWhere(
  input: MarketingRechargeListQueryInput,
): Prisma.MarketingRechargeWhereInput {
  return {
    storeId: input.storeId,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.startMs || input.endMs
      ? {
          createdAt: {
            ...(input.startMs ? { gte: new Date(input.startMs) } : {}),
            ...(input.endMs ? { lte: new Date(input.endMs) } : {}),
          },
        }
      : {}),
  };
}

export function buildPromotionWhere(
  input: MarketingPromotionListQueryInput,
): Prisma.MarketingPromotionWhereInput {
  const now = new Date();
  const where: Prisma.MarketingPromotionWhereInput = {
    storeId: input.storeId,
  };

  if (input.status === 'upcoming') {
    where.startAt = { gt: now };
  } else if (input.status === 'active') {
    where.startAt = { lte: now };
    where.endAt = { gte: now };
  } else if (input.status === 'ended') {
    where.endAt = { lt: now };
  }

  return where;
}
