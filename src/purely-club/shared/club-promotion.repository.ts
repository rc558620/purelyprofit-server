import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubPromotionsCacheKey } from '../../redis/keys/club-cache-keys';
import {
  resolveClubPromotionCacheTtlSeconds,
  runClubPromotionSingleflight,
} from './club-promotion-cache.helper';

export interface ClubActivePromotionRecord {
  id: number;
  name: string;
  type: 'first_order_discount' | 'discount' | 'discount_day' | 'reduce';
  params: unknown;
}

/**
 * 定价链路关心的活动类型：与 `ClubActivePromotionRecord['type']` 严格一一对应。
 * 类型收窄依赖这份白名单，新增类型时必须同步改两处（单测会断言一致性）。
 */
const CLUB_PRICING_PROMOTION_TYPES = [
  'first_order_discount',
  'discount',
  'discount_day',
  'reduce',
] as const;

/**
 * Club 活动共享查询 Repository（定价投影）。
 *
 * 消除 ClubProductPromotionService 与 ClubOrderPromotionsService 中
 * `loadActivePromotions` 完全重复的 marketingPromotion.findMany 查询。
 *
 * 缓存策略：
 *  - 门店粒度短 TTL，**TTL 由最近的活动边界决定**（见
 *    `resolveClubPromotionCacheTtlSeconds`），保证「到点即生效 / 即失效」；
 *  - 空数组同样缓存（无活动门店的空结果本身有效，避免每次都回源）；
 *  - 失效挂 `invalidateMarketingOverview`（活动创建/编辑/启停路径已调用）；
 *  - Redis 读/写异常一律降级回源，缓存不许变成故障点（下单定价依赖本方法）。
 */
@Injectable()
export class ClubPromotionRepository {
  private readonly logger = new Logger(ClubPromotionRepository.name);
  /** 缓存未命中时的进程内并发去重 */
  private readonly inflightLoads = new Map<
    string,
    Promise<ClubActivePromotionRecord[]>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 加载门店当前生效的定价活动（折扣 / 首单 / 折扣日 / 满减）。
   */
  async loadActivePromotions(
    storeId: number,
  ): Promise<ClubActivePromotionRecord[]> {
    const cacheKey = buildClubPromotionsCacheKey(storeId);
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    return runClubPromotionSingleflight(this.inflightLoads, cacheKey, () =>
      this.loadFromDatabase(storeId, cacheKey),
    );
  }

  private async loadFromDatabase(
    storeId: number,
    cacheKey: string,
  ): Promise<ClubActivePromotionRecord[]> {
    const now = new Date();
    // 只按 endAt 过滤：**未开始**的活动也要取回来 —— 它决定缓存的「开始」边界，
    // 漏掉就会让 12:00 开始的活动最长延后一个兜底 TTL 才生效。
    const rows = await this.prisma.marketingPromotion.findMany({
      where: {
        storeId,
        enabled: true,
        type: { in: [...CLUB_PRICING_PROMOTION_TYPES] },
        endAt: { gte: now },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        type: true,
        params: true,
        startAt: true,
        endAt: true,
      },
    });

    // where 已把 type 限定在 4 类白名单内，这里的收窄是类型层面的补充
    const active: ClubActivePromotionRecord[] = rows
      .filter((row) => row.startAt.getTime() <= now.getTime())
      .map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type as ClubActivePromotionRecord['type'],
        params: row.params,
      }));

    await this.writeCache(
      cacheKey,
      active,
      resolveClubPromotionCacheTtlSeconds(rows, now.getTime()),
    );

    return active;
  }

  /** 读缓存：异常降级为「未命中」，不阻断定价链路。 */
  private async readCache(
    cacheKey: string,
  ): Promise<ClubActivePromotionRecord[] | null> {
    try {
      return await this.redisService.getJson<ClubActivePromotionRecord[]>(
        cacheKey,
      );
    } catch (error) {
      this.logger.warn(
        `读取活动缓存失败 cacheKey=${cacheKey}，降级回源: ${this.toMessage(error)}`,
      );
      return null;
    }
  }

  /** 写缓存：失败只影响下次是否命中，不改变本次结果。 */
  private async writeCache(
    cacheKey: string,
    records: ClubActivePromotionRecord[],
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redisService.setJson(cacheKey, records, ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `写入活动缓存失败 cacheKey=${cacheKey} ttl=${ttlSeconds}s: ${this.toMessage(error)}`,
      );
    }
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
