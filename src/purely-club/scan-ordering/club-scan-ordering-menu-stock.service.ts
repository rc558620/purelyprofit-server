import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubMenuStockCacheKey } from '../../redis/keys/club-cache-keys';
import type {
  ClubMenuResponse,
  ClubMenuStaticResponse,
} from './club-scan-ordering-menu.types';

/**
 * 菜单库存快照缓存时长（秒）。
 *
 * 取舍：菜单主体按静态内容指纹长 TTL 缓存，库存必须比它新鲜得多。5s 让
 * 「同店其他顾客下单后的可用量」在一屏刷新内可见；再短则每桌点餐都要回源
 * （单次两条索引查询），再长则多人同桌点餐容易看到过期余量。
 */
const CLUB_MENU_STOCK_CACHE_TTL_SECONDS = 5;

/** 单个菜单商品的动态库存视图。 */
interface ClubMenuProductStock {
  /** 可用库存 = 总库存 - 已下单未接单预留量（下限 0） */
  available: number;
  salesCount: number;
}

/** 门店级库存快照：JSON 结构直接进 Redis，键为 ID 的字符串形式。 */
export interface ClubMenuStockSnapshot {
  products: Record<string, ClubMenuProductStock>;
  options: Record<string, number | null>;
}

/**
 * 扫码菜单的「动态列」服务：库存 / 已售。
 *
 * 背景：库存预留会 `version = version + 1`，而菜单缓存 key 曾由含 version 的
 * 内容指纹组成 —— 一笔下单就让整店菜单 key 轮换，全店在线顾客同时 miss 并各自
 * 回源四层 JOIN。把库存拆出来之后：
 *  - 菜单主体只随「菜单结构 / 价格 / 上下架」变化（改价即指纹变化，无需钩子）；
 *  - 库存走本服务的 5s 快照，精度反而从 30s 提升到 5s；
 *  - 对外响应字段与改造前完全一致（stockQuantity / salesCount 仍在原位）。
 */
@Injectable()
export class ClubScanOrderingMenuStockService {
  private readonly logger = new Logger(ClubScanOrderingMenuStockService.name);
  /** 进程内并发去重：同一门店同一时刻只回源一次。 */
  private readonly inflightSnapshots = new Map<
    number,
    Promise<ClubMenuStockSnapshot>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /** 取门店库存快照：Redis 命中即返回，未命中回源并回填。 */
  async resolveSnapshot(storeId: number): Promise<ClubMenuStockSnapshot> {
    const cacheKey = buildClubMenuStockCacheKey(storeId);
    try {
      const cached =
        await this.redisService.getJson<ClubMenuStockSnapshot>(cacheKey);
      if (cached) return cached;
    } catch (error) {
      // 缓存只是加速层：读失败降级为实时查询，不影响菜单可用性
      this.logger.warn(
        `读取菜单库存快照失败 storeId=${storeId}，回退实时查询: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return this.loadSnapshotOnce(storeId, cacheKey);
  }

  /** 把库存快照覆盖到静态菜单上，输出对前端不变的完整响应。 */
  applyStock(
    menu: ClubMenuStaticResponse,
    snapshot: ClubMenuStockSnapshot,
  ): ClubMenuResponse {
    return {
      menuVersion: menu.menuVersion,
      categories: menu.categories.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        products: category.products.map((product) => {
          const stock = snapshot.products[String(product.id)];
          return {
            id: product.id,
            categoryId: product.categoryId,
            name: product.name,
            description: product.description,
            imageUrl: product.imageUrl,
            basePrice: product.basePrice,
            stockMode: product.stockMode,
            stockQuantity: stock?.available ?? 0,
            salesCount: stock?.salesCount ?? 0,
            specGroups: product.specGroups.map((group) => ({
              id: group.id,
              name: group.name,
              selectionType: group.selectionType,
              minSelections: group.minSelections,
              maxSelections: group.maxSelections,
              options: group.options.map((option) => ({
                id: option.id,
                name: option.name,
                extraPrice: option.extraPrice,
                isDefault: option.isDefault,
                isActive: option.isActive,
                // null 表示不限库存，必须与「快照缺失」区分开
                stockQuantity:
                  snapshot.options[String(option.id)] === undefined
                    ? null
                    : snapshot.options[String(option.id)],
              })),
            })),
          };
        }),
      })),
    };
  }

  /** 单飞：同一门店的并发请求共用一次回源。 */
  private loadSnapshotOnce(
    storeId: number,
    cacheKey: string,
  ): Promise<ClubMenuStockSnapshot> {
    const inflight = this.inflightSnapshots.get(storeId);
    if (inflight) return inflight;

    const task = this.loadAndCacheSnapshot(storeId, cacheKey);
    this.inflightSnapshots.set(storeId, task);
    void task.finally(() => {
      this.inflightSnapshots.delete(storeId);
    });
    return task;
  }

  /** 回源 + 回填缓存（回填不阻塞响应）。 */
  private async loadAndCacheSnapshot(
    storeId: number,
    cacheKey: string,
  ): Promise<ClubMenuStockSnapshot> {
    const snapshot = await this.loadSnapshot(storeId);
    void this.writeSnapshotQuietly(cacheKey, snapshot);
    return snapshot;
  }

  /**
   * 回源：只取动态列，两条按 storeId 收敛的索引查询并行发出。
   *
   * 商品侧仍以关联商品的 `stock` 为准（与响应口径一致），规格项 `null` 原样保留
   * 表示不限库存。
   */
  private async loadSnapshot(storeId: number): Promise<ClubMenuStockSnapshot> {
    const [products, options] = await Promise.all([
      this.prisma.scanOrderingMenuProduct.findMany({
        where: { storeId, isActive: true, deletedAt: null },
        select: {
          id: true,
          stockQuantity: true,
          reservedQuantity: true,
          salesCount: true,
          product: { select: { stock: true } },
        },
      }),
      this.prisma.scanOrderingSpecOption.findMany({
        where: {
          isActive: true,
          group: {
            // 规格组对菜单商品的关系字段名是 product（见 operations schema）
            product: { storeId, isActive: true, deletedAt: null },
          },
        },
        select: { id: true, stockQuantity: true, reservedQuantity: true },
      }),
    ]);

    const productStocks: Record<string, ClubMenuProductStock> = {};
    for (const row of products) {
      const baseStock = row.product
        ? row.product.stock
        : (row.stockQuantity ?? 0);
      productStocks[String(row.id)] = {
        available: Math.max(0, baseStock - (row.reservedQuantity ?? 0)),
        salesCount: row.salesCount,
      };
    }

    const optionStocks: Record<string, number | null> = {};
    for (const row of options) {
      optionStocks[String(row.id)] =
        row.stockQuantity === null
          ? null
          : Math.max(0, row.stockQuantity - (row.reservedQuantity ?? 0));
    }

    return { products: productStocks, options: optionStocks };
  }

  /** 回填快照：写失败不影响本次返回，下次请求重算。 */
  private async writeSnapshotQuietly(
    cacheKey: string,
    snapshot: ClubMenuStockSnapshot,
  ): Promise<void> {
    try {
      await this.redisService.setJson(
        cacheKey,
        snapshot,
        CLUB_MENU_STOCK_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `回填菜单库存快照失败 cacheKey=${cacheKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
