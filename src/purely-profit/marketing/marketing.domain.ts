import { Prisma } from '@prisma/client';
import type {
  MarketingCustomerListQueryInput,
  MarketingProductListQueryInput,
  MarketingPromotionListQueryInput,
  MarketingRechargeListQueryInput,
} from './marketing.types';
import type { MarketingProductSortValue } from './marketing.utils';

export function buildCustomerWhere(
  input: MarketingCustomerListQueryInput,
): Prisma.MarketingCustomerWhereInput {
  const now = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * 86400_000);
  const cutoff90 = new Date(now.getTime() - 90 * 86400_000);
  const where: Prisma.MarketingCustomerWhereInput = {
    storeId: input.storeId,
    deletedAt: null,
  };

  // ── 状态筛选（独立 OR，不与关键字 OR 合并）──────────────────────
  if (input.status === 'new') {
    where.lastVisitAt = null;
  } else if (input.status === 'active') {
    where.lastVisitAt = { gte: cutoff30 };
  } else if (input.status === 'dormant') {
    where.lastVisitAt = { gte: cutoff90, lt: cutoff30 };
  } else if (input.status === 'lost') {
    where.lastVisitAt = { lt: cutoff90 };
  }

  if (input.tier) {
    (
      where as Prisma.MarketingCustomerWhereInput & {
        tier?: MarketingCustomerListQueryInput['tier'];
      }
    ).tier = input.tier;
  }

  // ── 关键字筛选（兼容旧版 keyword，与独立 name/phone 并列 AND）────────
  if (input.keyword) {
    const keywordClause: Prisma.MarketingCustomerWhereInput = {
      OR: [
        { name: { contains: input.keyword, mode: 'insensitive' } },
        { phone: { startsWith: input.keyword } },
      ],
    };
    const existingAnd = Array.isArray(where.AND) ? where.AND : [];
    where.AND = [...existingAnd, keywordClause];
  }

  // ── 独立姓名关键字（与 phone AND 并列）────────────────────────────
  if (input.name) {
    const nameClause: Prisma.MarketingCustomerWhereInput = {
      name: { contains: input.name, mode: 'insensitive' },
    };
    const existingAnd = Array.isArray(where.AND) ? where.AND : [];
    where.AND = [...existingAnd, nameClause];
  }

  // ── 独立手机号关键字（与 name AND 并列）────────────────────────────
  if (input.phone) {
    const phoneClause: Prisma.MarketingCustomerWhereInput = {
      phone: { startsWith: input.phone },
    };
    const existingAnd = Array.isArray(where.AND) ? where.AND : [];
    where.AND = [...existingAnd, phoneClause];
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

  if (input.enabled !== undefined) {
    where.enabled = input.enabled;
  }

  return where;
}

export function buildMarketingProductWhere(
  input: MarketingProductListQueryInput,
): Prisma.MarketingProductWhereInput {
  return {
    storeId: input.storeId,
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
  };
}

export function resolveMarketingProductOrderBy(
  sortBy: MarketingProductSortValue | undefined,
): Prisma.MarketingProductOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'name':
      return [{ name: 'asc' }, { id: 'desc' }];
    case 'price_asc':
      return [{ price: 'asc' }, { id: 'desc' }];
    case 'price_desc':
      return [{ price: 'desc' }, { id: 'desc' }];
    case 'createdAt':
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}
