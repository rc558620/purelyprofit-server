import { Injectable, Logger } from '@nestjs/common';
import { MARKETING_PROMOTION_TYPE_VALUES } from '../../purely-profit/marketing/marketing.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisReadPrefetchService } from '../../redis/redis-read-prefetch.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubPromotionListCacheKey } from '../../redis/keys/club-cache-keys';
import {
  resolveClubPromotionCacheTtlSeconds,
  runClubPromotionSingleflight,
} from '../shared/club-promotion-cache.helper';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type { ClubPromotionsResponseDto } from './dto/club-promotion.dto';
import { buildClubPromotionItems } from './club-promotions.presenter';
import {
  clubPromotionSelect,
  type ClubPromotionRecord,
} from './club-promotions.types';

/**
 * 缓存中的活动记录形状：Date 字段经 JSON 序列化后是 ISO 字符串，
 * 读取时必须还原成 Date——直接 cast 回 ClubPromotionRecord 会让
 * startAt.getTime() 之类的调用在运行时崩掉。
 */
type CachedClubPromotionRecord = Omit<
  ClubPromotionRecord,
  'startAt' | 'endAt' | 'createdAt'
> & {
  startAt: string;
  endAt: string;
  createdAt: string;
};

@Injectable()
export class ClubPromotionsService {
  private readonly logger = new Logger(ClubPromotionsService.name);
  /** 缓存未命中时的进程内并发去重 */
  private readonly inflightLoads = new Map<
    string,
    Promise<ClubPromotionRecord[]>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly redisReadPrefetch: RedisReadPrefetchService,
  ) {}

  async list(
    currentContext: ClubCurrentContext,
  ): Promise<ClubPromotionsResponseDto> {
    const now = new Date();
    const promotions = await this.loadActivePromotions(
      currentContext.store.id,
      now,
    );

    return { items: buildClubPromotionItems(promotions, now) };
  }

  /**
   * 读取当前门店生效活动（展示口径），优先走门店级缓存。
   *
   * 首页与活动页每次进入都会调 list，而活动只在后台改配置时变化，
   * 未缓存时每个 C 端页面进入都要跑一次 marketingPromotion 查询。
   *
   * 缓存口径：
   *  - TTL 由最近的活动边界决定（见 resolveClubPromotionCacheTtlSeconds），
   *    保证未开始活动到点即出现、已结束活动到点即消失；
   *  - 无 take：缓存全量「未结束 + 启用 + 白名单类型」活动，展示上限在排序后
   *    截断。窗口过滤已排除历史活动，正常门店只有几条到几十条；
   *  - 空数组同样缓存；
   *  - Redis 异常降级回源，缓存不许变成故障点。
   *
   * 【已评估：不下推 ORDER BY / LIMIT】单店行数有业务硬上界——`ensurePromotionTypeUnique`
   * 强制 `(storeId, type, enabled=true)` 唯一，白名单 9 种类型 → 每店 ≤9 行
   * （本地真实库实测窗口内 5–6 行，avg 5.67，max 6）。下推只能省 ≤9 行传输与一次
   * ≤9 元素 sort（<0.1ms），却要在 SQL 复刻 presenter 里 resolvePresentation 的
   * (sort, priority) 常量映射；漂移代价远高于收益，故维持现状。
   * 复测：`SELECT store_id, count(*) FROM marketing_promotions WHERE enabled AND
   * end_at >= now() GROUP BY 1 ORDER BY 2 DESC LIMIT 20;` 出现单店 >50 行（唯一
   * 约束被绕过）时再重新评估下推。
   */
  private async loadActivePromotions(
    storeId: number,
    now: Date,
  ): Promise<ClubPromotionRecord[]> {
    const cacheKey = buildClubPromotionListCacheKey(storeId);
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached.map((record) => this.revivePromotionRecord(record));
    }

    return runClubPromotionSingleflight(this.inflightLoads, cacheKey, () =>
      this.loadFromDatabase(storeId, cacheKey, now),
    );
  }

  private async loadFromDatabase(
    storeId: number,
    cacheKey: string,
    now: Date,
  ): Promise<ClubPromotionRecord[]> {
    // 只按 endAt 过滤：未开始的活动也要取回来，它决定缓存的「开始」边界
    const rows = await this.prisma.marketingPromotion.findMany({
      where: {
        storeId,
        enabled: true,
        type: { in: [...MARKETING_PROMOTION_TYPE_VALUES] },
        endAt: { gte: now },
      },
      select: clubPromotionSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const active = rows.filter((row) => row.startAt.getTime() <= now.getTime());

    await this.writeCache(
      cacheKey,
      active,
      resolveClubPromotionCacheTtlSeconds(rows, now.getTime()),
    );

    return active;
  }

  /**
   * 读缓存：异常降级为「未命中」，不阻断首页/活动页。
   *
   * 首页聚合已用一次 MGET 预取本 key，命中即省掉本次往返；未预取时回退单条 GET。
   */
  private async readCache(
    cacheKey: string,
  ): Promise<CachedClubPromotionRecord[] | null> {
    const prefetched =
      await this.redisReadPrefetch.peekJson<CachedClubPromotionRecord[]>(
        cacheKey,
      );
    if (prefetched !== undefined) {
      return prefetched;
    }

    try {
      return await this.redisService.getJson<CachedClubPromotionRecord[]>(
        cacheKey,
      );
    } catch (error) {
      this.logger.warn(
        `读取活动列表缓存失败 cacheKey=${cacheKey}，降级回源: ${this.toMessage(error)}`,
      );
      return null;
    }
  }

  /** 写缓存：失败只影响下次是否命中，不改变本次结果。 */
  private async writeCache(
    cacheKey: string,
    records: ClubPromotionRecord[],
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redisService.setJson(cacheKey, records, ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `写入活动列表缓存失败 cacheKey=${cacheKey} ttl=${ttlSeconds}s: ${this.toMessage(error)}`,
      );
    }
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** 把缓存里被 JSON 序列化成 ISO 字符串的日期字段还原为 Date */
  private revivePromotionRecord(
    record: CachedClubPromotionRecord,
  ): ClubPromotionRecord {
    return {
      ...record,
      startAt: new Date(record.startAt),
      endAt: new Date(record.endAt),
      createdAt: new Date(record.createdAt),
    };
  }
}
