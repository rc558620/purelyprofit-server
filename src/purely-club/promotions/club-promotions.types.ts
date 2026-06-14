import type { Prisma } from '@prisma/client';

export const clubPromotionSelect = {
  id: true,
  name: true,
  type: true,
  description: true,
  params: true,
  startAt: true,
  endAt: true,
  createdAt: true,
} as const satisfies Prisma.MarketingPromotionSelect;

export type ClubPromotionRecord = Prisma.MarketingPromotionGetPayload<{
  select: typeof clubPromotionSelect;
}>;
