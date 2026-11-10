import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { RedisService } from '../../../redis/redis.service';
import {
  buildClubMenuPattern,
  buildClubMenuVersionCacheKey,
} from '../../../redis/keys/club-cache-keys';
import type { ScanOrderingMenuCategoryResponse } from './scan-ordering-menu-category.service';

/**
 * 商家菜单缓存：固定 key + 写路径主动失效（见 invalidateMenuCache）。
 *
 * TTL 从 300s 收到 60s，只作为「漏失效 / 外部改数据」的兜底——一次漏失效
 * 原本会让商家看到 5 分钟旧菜单。singleflight 防止失效瞬间并发请求一起回源；
 * 读写 Redis 失败均降级查库，缓存不是唯一数据源。
 */
const MERCHANT_MENU_CACHE_TTL_SECONDS = 60;

function buildMerchantMenuCacheKey(storeId: number): string {
  return `scanordering:menu:${storeId}`;
}

/**
 * 商家扫码点餐菜单查询服务（含缓存）。
 */
@Injectable()
export class ScanOrderingMenuQueryService {
  private readonly logger = new Logger(ScanOrderingMenuQueryService.name);
  /** 未命中路径的进程内并发去重：同一缓存 key 共用一次回源。 */
  private readonly inflightMenuLoads = new Map<
    string,
    Promise<ScanOrderingMenuCategoryResponse[]>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly redisService: RedisService,
  ) {}

  async listMenu(
    user: AuthenticatedUser,
  ): Promise<ScanOrderingMenuCategoryResponse[]> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看扫码点餐菜单',
    );

    const cacheKey = buildMerchantMenuCacheKey(storeId);
    let cached: ScanOrderingMenuCategoryResponse[] | null = null;
    try {
      cached =
        await this.redisService.getJson<ScanOrderingMenuCategoryResponse[]>(
          cacheKey,
        );
    } catch (error) {
      this.logger.warn(
        `读取商家菜单缓存失败 storeId=${storeId}，回退查库: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (cached) return cached;

    return this.loadMenuOnce(cacheKey, () => this.buildMenu(storeId, cacheKey));
  }

  /**
   * 失效门店菜单缓存：商家菜单 CRUD 写路径调用。
   *
   * 与 products-scan-ordering-sync.service.ts 的 invalidateCache 同口径，三份
   * 缓存都要清：商家端固定 key、C 端版本化菜单 key（按 pattern）、C 端版本缓存。
   * 少清任一份都会让改价 / 上下架 / 改规格后顾客端延迟看到新菜单。
   * 失效失败不阻断写操作，由商家端 60s 与 C 端短版本 TTL 兜底。
   */
  async invalidateMenuCache(storeId: number): Promise<void> {
    try {
      await this.redisService.del(buildMerchantMenuCacheKey(storeId));
      await this.redisService.delByPattern(buildClubMenuPattern(storeId));
      await this.redisService.del(buildClubMenuVersionCacheKey(storeId));
    } catch (error) {
      this.logger.warn(
        `失效扫码点餐菜单缓存失败 storeId=${storeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 未命中路径的并发去重（singleflight）；不改变既有缓存 value 格式。 */
  private loadMenuOnce(
    cacheKey: string,
    load: () => Promise<ScanOrderingMenuCategoryResponse[]>,
  ): Promise<ScanOrderingMenuCategoryResponse[]> {
    const inflight = this.inflightMenuLoads.get(cacheKey);
    if (inflight) return inflight;
    const task = load().finally(() => {
      this.inflightMenuLoads.delete(cacheKey);
    });
    this.inflightMenuLoads.set(cacheKey, task);
    return task;
  }

  /** 回源组装商家菜单并回填缓存。 */
  private async buildMenu(
    storeId: number,
    cacheKey: string,
  ): Promise<ScanOrderingMenuCategoryResponse[]> {
    const categories = await this.prisma.scanOrderingMenuCategory.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        products: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    });

    const menu = categories.map((category) => ({
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      products: category.products.map((product) => ({
        id: product.id,
        name: product.name,
        basePrice: Money.fromDbCents(product.basePrice).toOutputYuan(),
        imageUrl: product.imageUrl || null,
        isActive: product.isActive,
        stockMode: product.stockMode,
        // 可用库存 = 总库存 - 已下单未接单的预留量（接单后才真正扣减）
        stockQuantity:
          product.stockQuantity === null
            ? null
            : Math.max(
                0,
                product.stockQuantity - (product.reservedQuantity ?? 0),
              ),
        sortOrder: product.sortOrder,
      })),
    }));

    await this.writeMenuCacheQuietly(cacheKey, menu);
    return menu;
  }

  /** 回填菜单缓存：写失败不影响本次返回，由短 TTL 与后续请求自愈。 */
  private async writeMenuCacheQuietly(
    cacheKey: string,
    menu: ScanOrderingMenuCategoryResponse[],
  ): Promise<void> {
    try {
      await this.redisService.setJson(
        cacheKey,
        menu,
        MERCHANT_MENU_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `回填商家菜单缓存失败 cacheKey=${cacheKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
