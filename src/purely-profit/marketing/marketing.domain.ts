import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type {
  MarketingCustomerListQueryInput,
  MarketingProductListQueryInput,
  MarketingPromotionListQueryInput,
  MarketingRechargeListQueryInput,
  MarketingRechargeRow,
} from './marketing.types';
import type { MarketingProductSortValue } from './marketing.utils';
import type { MarketingRechargeDto } from './dto/marketing-response.dto';
import { mapRechargeRow } from './marketing.mapper';
import { Money } from '../../shared/money.utils';

export function buildCustomerWhere(
  input: MarketingCustomerListQueryInput,
): Prisma.MarketingCustomerWhereInput {
  const now = new Date();
  const cutoff7 = new Date(now.getTime() - 7 * 86400_000);
  const cutoff30 = new Date(now.getTime() - 30 * 86400_000);
  const cutoff90 = new Date(now.getTime() - 90 * 86400_000);
  const where: Prisma.MarketingCustomerWhereInput = {
    storeId: input.storeId,
    deletedAt: null,
  };

  // ── 状态筛选（独立 OR，不与关键字 OR 合并）──────────────────────
  if (input.status === 'new') {
    where.createdAt = { gte: cutoff7 };
  } else if (input.status === 'active') {
    where.createdAt = { lt: cutoff7 };
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

/**
 * 为退款记录补充 giftCleared 字段。
 * 通过按时间顺序遍历所有充值记录，计算每笔退款时的赠送余额。
 */
export async function enrichRefundGiftCleared(
  prisma: PrismaService,
  customerId: number,
  pageRows: MarketingRechargeRow[],
): Promise<MarketingRechargeDto[]> {
  // 检查是否有退款记录需要处理
  const hasRefund = pageRows.some((r) => (r.type as string) === 'refund');
  if (!hasRefund) {
    return pageRows.map(mapRechargeRow);
  }

  // 获取所有充值记录（按时间升序）用于计算赠送余额
  const allRows = await prisma.$queryRaw<MarketingRechargeRow[]>`
    SELECT id, amount, gift_amount AS "giftAmount", total_amount AS "totalAmount",
           type::text AS "type", created_at AS "createdAt"
    FROM marketing_recharges
    WHERE customer_id = ${customerId}
    ORDER BY created_at ASC, id ASC
  `;

  // 构建 refundId -> giftCleared 映射（基于时间线 trackedGift 算法）
  const giftClearedMap = new Map<number, number>();
  let trackedGift = 0;

  for (const row of allRows) {
    const type = row.type as string;
    if (type === 'recharge' || type === 'gift') {
      trackedGift += row.giftAmount;
    } else if (type === 'refund') {
      // BUG-1: 退款实际清零的赠送金额 = min(trackedGift, row.giftAmount)
      const cleared = Math.min(trackedGift, row.giftAmount);
      giftClearedMap.set(row.id, cleared);
      trackedGift = Math.max(0, trackedGift - row.giftAmount);
    }
  }

  return pageRows.map((row) => {
    const dto = mapRechargeRow(row);
    if ((row.type as string) === 'refund') {
      const giftCleared = giftClearedMap.get(row.id) ?? 0;
      if (giftCleared > 0) {
        // B5: 使用结构化字段返回赠送清零金额
        dto.giftClearedAmount = Money.fromDbCents(giftCleared).toOutputYuan();
      }
    }
    return dto;
  });
}
