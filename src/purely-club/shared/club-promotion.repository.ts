import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ClubActivePromotionRecord {
  id: number;
  name: string;
  type: 'first_order_discount' | 'discount' | 'discount_day' | 'reduce';
  params: unknown;
}

/**
 * Club 活动共享查询 Repository
 *
 * 消除 ClubProductPromotionService 与 ClubOrderPromotionsService 中
 * loadActivePromotions 完全重复的 marketingPromotion.findMany 查询。
 */
@Injectable()
export class ClubPromotionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 加载门店当前生效的全部营销活动（折扣 / 首单 / 折扣日 / 满减）
   */
  loadActivePromotions(storeId: number): Promise<ClubActivePromotionRecord[]> {
    const now = new Date();
    return this.prisma.marketingPromotion.findMany({
      where: {
        storeId,
        enabled: true,
        type: {
          in: ['first_order_discount', 'discount', 'discount_day', 'reduce'],
        },
        startAt: { lte: now },
        endAt: { gte: now },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        type: true,
        params: true,
      },
    }) as Promise<ClubActivePromotionRecord[]>;
  }
}
