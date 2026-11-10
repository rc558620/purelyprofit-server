import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildCategoriesListCacheKey } from '../../../redis/cache-keys';
import { RedisService } from '../../../redis/redis.service';
import { buildCategoryResponse } from './categories.mapper';
import {
  findCategoryListVersion,
  listCategoryRecords,
} from './categories.query';
import type { CategoryListQueryInput } from './categories.types';
import type {
  CategoryResponseDto,
  ListCategoriesQueryDto,
} from './dto/category.dto';

/**
 * 分类列表读缓存：短 TTL + 版本化 key（与 purelyClub 菜单缓存同策略）。
 *
 * 命中时跳过 product_categories 列表查询、排序与 DTO 映射；版本由一次轻量
 * 聚合得出，分类写路径都会换 key，故无需 invalidator；极端同毫秒重复写
 * 由 TTL 兜底。Redis 故障时降级为直接查库，缓存只作为加速层。
 */
const CATEGORIES_LIST_CACHE_TTL_SECONDS = 30;

@Injectable()
export class CategoriesReadService {
  private readonly logger = new Logger(CategoriesReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly redisService: RedisService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListCategoriesQueryDto,
  ): Promise<CategoryResponseDto[]> {
    // 权限解析在缓存之前，且 key 按门店隔离，缓存不会跨门店复用
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'goods:view',
      '无权查看该门店商品分类',
    );

    if (storeId === null) {
      return [];
    }

    const version = await findCategoryListVersion(this.prisma, storeId);
    const cacheKey = buildCategoriesListCacheKey(
      storeId,
      version,
      query.keyword,
    );
    const cached = await this.readCachedList(cacheKey, storeId);
    if (cached !== null) {
      return cached;
    }

    const items = await listCategoryRecords(
      this.prisma,
      this.toListQueryInput(storeId, query),
    );
    const response = items.map(buildCategoryResponse);

    await this.writeCachedList(cacheKey, storeId, response);
    return response;
  }

  private async readCachedList(
    cacheKey: string,
    storeId: number,
  ): Promise<CategoryResponseDto[] | null> {
    try {
      return await this.redisService.getJson<CategoryResponseDto[]>(cacheKey);
    } catch (error) {
      this.logger.warn(
        `读取分类列表缓存失败，降级查库 storeId=${storeId}: ${this.toErrorMessage(error)}`,
      );
      return null;
    }
  }

  private async writeCachedList(
    cacheKey: string,
    storeId: number,
    response: CategoryResponseDto[],
  ): Promise<void> {
    try {
      await this.redisService.setJson(
        cacheKey,
        response,
        CATEGORIES_LIST_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `写入分类列表缓存失败 storeId=${storeId}: ${this.toErrorMessage(error)}`,
      );
    }
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private toListQueryInput(
    storeId: number,
    query: ListCategoriesQueryDto,
  ): CategoryListQueryInput {
    return {
      storeId,
      keyword: query.keyword,
    };
  }
}
