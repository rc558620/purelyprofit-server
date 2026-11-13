import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  buildClubProductDetailCacheKey,
  buildClubProductListCacheKey,
  buildClubProductsVersionCacheKey,
} from '../../redis/keys/club-cache-keys';
import type { ClubProductRecord } from './club-products.types';

/**
 * 商品读缓存 TTL（秒）。
 *
 * 与列表接口 @CacheControl(maxAge=30) 对齐：商品是门店级低频变更数据，
 * C 端首屏与翻页在 30s 内的重复请求可直接命中。缓存只是加速层，
 * Redis 异常时全部降级回源，不能让商品接口因缓存不可用而失败。
 */
const CLUB_PRODUCTS_CACHE_TTL_SECONDS = 30;

/**
 * 商品版本缓存 TTL（秒）。
 *
 * 版本是缓存 key 的一部分，每次请求都要先取版本；版本只由「上架商品数量 +
 * 最大更新时间」构成，聚合查询很轻，但仍没必要每个请求回源。10s 意味着商家
 * 改价 / 上下架 / 库存变动最多 10s 后可见。旧版本 key 自然过期，因此无需在
 * B 端商品 CRUD 与 C 端下单 / 退款等写路径上逐一挂失效，避免跨模块耦合。
 */
const CLUB_PRODUCTS_VERSION_CACHE_TTL_SECONDS = 10;

/** Date 经过 JSON 往返会退化为字符串，缓存统一用毫秒时间戳保存。 */
type CachedClubProductRecord = Omit<
  ClubProductRecord,
  'createdAt' | 'updatedAt'
> & {
  createdAt: number;
  updatedAt: number;
};

export interface ClubProductListCacheParams {
  storeId: number;
  categoryId?: number;
  cursor?: number;
  take?: number;
}

const toCachedRecord = (
  record: ClubProductRecord,
): CachedClubProductRecord => ({
  ...record,
  createdAt: record.createdAt.getTime(),
  updatedAt: record.updatedAt.getTime(),
});

const fromCachedRecord = (
  cached: CachedClubProductRecord,
): ClubProductRecord => ({
  ...cached,
  createdAt: new Date(cached.createdAt),
  updatedAt: new Date(cached.updatedAt),
});

/**
 * C 端服务商品读缓存。
 *
 * 只缓存「门店级商品记录」，不缓存用户级定价（会员折扣 / 首单资格因人而异），
 * 定价上下文仍由 ClubProductPromotionService 每次实时解析。
 * 版本化 key 让商品变更自动切换 key，无需主动失效；旧 key 靠 TTL 回收。
 */
@Injectable()
export class ClubProductCacheService {
  private readonly logger = new Logger(ClubProductCacheService.name);
  /** 版本未命中时的进程内并发去重，避免同一门店的聚合查询被并发放大。 */
  private readonly inflightVersions = new Map<number, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async buildListCacheKey(params: ClubProductListCacheParams): Promise<string> {
    const version = await this.resolveVersion(params.storeId);
    return buildClubProductListCacheKey(params.storeId, version, params);
  }

  async buildDetailCacheKey(
    storeId: number,
    productId: number,
  ): Promise<string> {
    const version = await this.resolveVersion(storeId);
    return buildClubProductDetailCacheKey(storeId, version, productId);
  }

  async readList(cacheKey: string): Promise<ClubProductRecord[] | null> {
    const cached = await this.read<CachedClubProductRecord[]>(cacheKey);
    return cached ? cached.map(fromCachedRecord) : null;
  }

  async writeList(
    cacheKey: string,
    records: ClubProductRecord[],
  ): Promise<void> {
    await this.write(cacheKey, records.map(toCachedRecord));
  }

  async readDetail(cacheKey: string): Promise<ClubProductRecord | null> {
    const cached = await this.read<CachedClubProductRecord>(cacheKey);
    return cached ? fromCachedRecord(cached) : null;
  }

  async writeDetail(
    cacheKey: string,
    record: ClubProductRecord,
  ): Promise<void> {
    await this.write(cacheKey, toCachedRecord(record));
  }

  /** 版本缓存未命中时并发回源，命中路径不进这里。 */
  private async resolveVersion(storeId: number): Promise<string> {
    const inflight = this.inflightVersions.get(storeId);
    if (inflight) {
      return inflight;
    }

    const task = this.loadVersion(storeId);
    this.inflightVersions.set(storeId, task);
    try {
      return await task;
    } finally {
      this.inflightVersions.delete(storeId);
    }
  }

  private async loadVersion(storeId: number): Promise<string> {
    const cacheKey = buildClubProductsVersionCacheKey(storeId);
    const cached = await this.read<string>(cacheKey);
    if (cached) {
      return cached;
    }

    // 上架商品数感知新增 / 删除 / 上下架，最大 updatedAt 感知改价与库存变动。
    // (store_id, is_active, updated_at) 现有索引可直接服务这条聚合。
    const aggregate = await this.prisma.marketingProduct.aggregate({
      where: { storeId, isActive: true },
      _count: true,
      _max: { updatedAt: true },
    });
    const fingerprint = `${aggregate._count}:${aggregate._max.updatedAt?.getTime() ?? 0}`;
    const version = createHash('sha256')
      .update(fingerprint)
      .digest('hex')
      .slice(0, 16);

    await this.write(
      cacheKey,
      version,
      CLUB_PRODUCTS_VERSION_CACHE_TTL_SECONDS,
    );
    return version;
  }

  private async read<T>(cacheKey: string): Promise<T | null> {
    try {
      return await this.redisService.getJson<T>(cacheKey);
    } catch (error) {
      this.logger.warn(
        `读取商品缓存失败 cacheKey=${cacheKey}，降级回源: ${this.toMessage(error)}`,
      );
      return null;
    }
  }

  private async write(
    cacheKey: string,
    value: unknown,
    ttlSeconds: number = CLUB_PRODUCTS_CACHE_TTL_SECONDS,
  ): Promise<void> {
    try {
      await this.redisService.setJson(cacheKey, value, ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `写入商品缓存失败 cacheKey=${cacheKey}: ${this.toMessage(error)}`,
      );
    }
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
