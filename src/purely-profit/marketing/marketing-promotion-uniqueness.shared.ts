// 活动唯一性校验：应用层 count + 文案口径与 DB 部分唯一索引保持一致
import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  PROMOTION_TYPE_CONFLICT_MESSAGE,
  type MarketingPromotionTypeValue,
} from './marketing.utils';

/** 同类型活动唯一（仅启用态参与比较），编辑时通过 excludePromotionId 排除自身 */
export const ensurePromotionTypeUnique = async (
  prisma: PrismaService,
  storeId: number,
  type: MarketingPromotionTypeValue,
  excludePromotionId?: number,
): Promise<void> => {
  const duplicatedCount = await prisma.marketingPromotion.count({
    where: {
      storeId,
      type,
      enabled: true,
      ...(excludePromotionId !== undefined
        ? { id: { not: excludePromotionId } }
        : {}),
    },
  });

  if ((duplicatedCount ?? 0) > 0) {
    throw new ConflictException(PROMOTION_TYPE_CONFLICT_MESSAGE);
  }
};

/** 签到活动的全量唯一校验（含停用态）：与 DB 部分唯一索引口径一致 */
export const ensureDailyCheckInUniqueness = async (
  prisma: PrismaService,
  storeId: number,
  excludePromotionId?: number,
): Promise<void> => {
  const duplicatedCount = await prisma.marketingPromotion.count({
    where: {
      storeId,
      type: 'daily_check_in',
      ...(excludePromotionId !== undefined
        ? { id: { not: excludePromotionId } }
        : {}),
    },
  });

  if ((duplicatedCount ?? 0) > 0) {
    throw new ConflictException(PROMOTION_TYPE_CONFLICT_MESSAGE);
  }
};
