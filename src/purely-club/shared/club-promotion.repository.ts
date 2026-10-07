import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubPromotionsCacheKey } from '../../redis/keys/club-cache-keys';

export interface ClubActivePromotionRecord {
  id: number;
  name: string;
  type: 'first_order_discount' | 'discount' | 'discount_day' | 'reduce';
  params: unknown;
}

/** 活动促销缓存 TTL（秒） */
const CLUB_PROMOTIONS_CACHE_TTL_SECONDS = 60;

/**
 * Club 活动共享查询 Repository
 *
 * 消除 ClubProductPromotionService 与 ClubOrderPromotionsService 中
 * loadActivePromotions 完全重复的 marketingPromotion.findMany 查询。
 *
 * 缓存策略：门店粒度 60s TTL，空数组同样缓存（无活动门店的空结果本身有效）。
 * 失效挂 invalidateMarketingOverview（活动创建/编辑/启停路径已调用）。
 */
@Injectable()
export class ClubPromotionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 加载门店当前生效的全部营销活动（折扣 / 首单 / 折扣日 / 满减）
   */
  async loadActivePromotions(
    storeId: number,
  ): Promise<ClubActivePromotionRecord[]> {
    const cacheKey = buildClubPromotionsCacheKey(storeId);
    const cached =
      await this.redisService.getJson<ClubActivePromotionRecord[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const now = new Date();
    const records = await this.prisma.marketingPromotion.findMany({
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
    }) as ClubActivePromotionRecord[];

    // 写缓存：空数组同样缓存 60s（无活动门店的空结果本身有效）
    await this.redisService.setJson(
      cacheKey,
      records,
      CLUB_PROMOTIONS_CACHE_TTL_SECONDS,
    );

    return records;
  }
}
