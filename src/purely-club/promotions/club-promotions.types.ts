import type { Prisma } from '@prisma/client';
import type { MarketingPromotionTypeValue } from '../../purely-profit/marketing/marketing.utils';

export const clubPromotionSelect = {
  id: true,
  name: true,
  type: true,
  description: true,
  params: true,
  startAt: true,
  endAt: true,
  createdAt: true,
} as const;

export interface ClubPromotionRecord {
  id: number;
  name: string;
  type: MarketingPromotionTypeValue;
  description: string;
  params: Prisma.JsonValue;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
}
