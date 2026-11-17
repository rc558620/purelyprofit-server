import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  buildClubMenuCacheKey,
  buildClubMenuVersionCacheKey,
} from '../../redis/keys/club-cache-keys';
import {
  CLUB_MENU_CATEGORY_SELECT,
  type ClubMenuCategoryRow,
  type ClubMenuProductRow,
  type ClubMenuResponse,
  type ClubMenuSpecGroupRow,
  type ClubMenuSpecOptionRow,
  type ClubMenuStaticCategory,
  type ClubMenuStaticProduct,
  type ClubMenuStaticResponse,
  type ClubMenuStaticSpecGroup,
  type ClubMenuStaticSpecOption,
} from './club-scan-ordering-menu.types';
import { ClubScanOrderingMenuStockService } from './club-scan-ordering-menu-stock.service';

/**
 * 菜单静态缓存时长（秒）。
 *
 * key 是静态内容指纹（价格 / 上下架 / 规格结构参与计算），菜单写路径还会按
 * pattern 主动删除，因此 TTL 只兜「漏挂失效」这一种情况，可以放长。
 * 库存与销量不在这份 value 里（见 ClubScanOrderingMenuStockService，5s）。
 */
const CLUB_MENU_CACHE_TTL_SECONDS = 300;
/**
 * 菜单版本自身缓存时长（秒）。
 *
 * 菜单缓存 key 由 menuVersion 组成，所以每次菜单请求都要先算出版本；但版本
 * 只在菜单结构/库存预留变化时改变，没必要每个请求都重算一次四层 JOIN。
 * TTL 取很短的值：版本缓存只会让「菜单变更被发现」最多延后本时长，且写路径
 * （商家改菜单、C 端下单预留库存）会主动删除，实际命中即失效。
 */
const CLUB_MENU_VERSION_CACHE_TTL_SECONDS = 10;

/**
 * 菜单版本指纹查询的结果行。
 *
 * 聚合查询恒定返回 1 行：`string_agg` 在空集上是 NULL，已被 `COALESCE` 兜成
 * 空串，因此空菜单同样得到一个稳定的 md5（即空串的 md5）。
 */
interface MenuVersionFingerprintRow {
  fingerprint: string;
}

@Injectable()
export class ClubScanOrderingMenuQueryService {
  private readonly logger = new Logger(ClubScanOrderingMenuQueryService.name);
  /** 未命中路径的进程内并发去重：同一缓存 key 共用一次回源。 */
  private readonly inflightMenuLoads = new Map<
    string,
    Promise<ClubMenuStaticResponse>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly menuStockService: ClubScanOrderingMenuStockService,
  ) {}

  async getMenu(
    user: AuthenticatedUser,
    sessionId: number,
  ): Promise<ClubMenuResponse> {
    // 只取 storeId：整行会话含二维码 token 哈希/设备信息等敏感字段，读回内存
    // 没有任何消费方，属于无谓的敏感数据面。
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: sessionId,
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
      select: { storeId: true },
    });
    if (!session)
      throw new ForbiddenException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_TABLE_SESSION_UNAVAILABLE,
          '当前桌台会话不可用，请重新扫码',
        ),
      );

    // 缓存 key 依赖 menuVersion；版本本身有短 TTL 缓存，这里不一定真的查库
    // （口径见 resolveMenuVersion / computeMenuVersion）
    const menuVersion = await this.resolveMenuVersion(session.storeId);

    // 缓存命中检查：menuVersion 不变即命中。
    // Redis 异常时降级回源，缓存只是加速层，不能让菜单接口因此不可用。
    const cacheKey = buildClubMenuCacheKey(session.storeId, menuVersion);
    let cached: ClubMenuStaticResponse | null = null;
    try {
      cached =
        await this.redisService.getJson<ClubMenuStaticResponse>(cacheKey);
    } catch (error) {
      this.logger.warn(
        `读取菜单缓存失败 cacheKey=${cacheKey}，回退实时菜单: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const staticMenu =
      cached ??
      (await this.loadMenuOnce(cacheKey, () =>
        this.buildMenu(session.storeId, menuVersion, cacheKey),
      ));

    // 库存 / 销量是每笔订单都会变的列，不进菜单缓存：走 5s 快照覆盖，
    // 这样一笔下单不再让整店菜单 key 轮换（原指纹含 version 时的击穿点）。
    const stockSnapshot = await this.menuStockService.resolveSnapshot(
      session.storeId,
    );
    return this.menuStockService.applyStock(staticMenu, stockSnapshot);
  }

  /** 未命中路径的并发去重（singleflight）；只缓存静态部分。 */
  private loadMenuOnce(
    cacheKey: string,
    load: () => Promise<ClubMenuStaticResponse>,
  ): Promise<ClubMenuStaticResponse> {
    const inflight = this.inflightMenuLoads.get(cacheKey);
    if (inflight) return inflight;
    const task = load().finally(() => {
      this.inflightMenuLoads.delete(cacheKey);
    });
    this.inflightMenuLoads.set(cacheKey, task);
    return task;
  }

  /** 未命中时回源组装静态菜单（不含库存/销量），并回填缓存。 */
  private async buildMenu(
    storeId: number,
    menuVersion: string,
    cacheKey: string,
  ): Promise<ClubMenuStaticResponse> {
    const categories = await this.prisma.scanOrderingMenuCategory.findMany({
      where: {
        storeId,
        isActive: true,
        deletedAt: null,
        products: { some: { deletedAt: null } },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: CLUB_MENU_CATEGORY_SELECT,
    });
    const result: ClubMenuStaticResponse = {
      menuVersion,
      categories: categories.map((category) => this.mapMenuCategory(category)),
    };

    await this.writeMenuCacheQuietly(cacheKey, result);

    return result;
  }

  private mapMenuCategory(
    category: ClubMenuCategoryRow,
  ): ClubMenuStaticCategory {
    return {
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      products: category.products.map((product) =>
        this.mapMenuProduct(product),
      ),
    };
  }

  private mapMenuProduct(product: ClubMenuProductRow): ClubMenuStaticProduct {
    return {
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      description: product.description,
      // 关联商品时图片回落商品主图（与响应口径一致）
      imageUrl: product.product?.image ?? product.imageUrl,
      basePrice: product.basePrice,
      // 关联普通商品时库存以商品表为准，等同「有限库存」
      stockMode: product.product ? 'finite' : product.stockMode,
      specGroups: product.specGroups.map((group) => this.mapSpecGroup(group)),
    };
  }

  private mapSpecGroup(group: ClubMenuSpecGroupRow): ClubMenuStaticSpecGroup {
    return {
      id: group.id,
      name: group.name,
      selectionType: group.selectionType,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      options: group.options.map((option) => this.mapSpecOption(option)),
    };
  }

  private mapSpecOption(
    option: ClubMenuSpecOptionRow,
  ): ClubMenuStaticSpecOption {
    return {
      id: option.id,
      name: option.name,
      extraPrice: option.extraPrice,
      isDefault: option.isDefault,
      isActive: option.isActive,
    };
  }

  /** 回填菜单缓存：写失败不影响本次返回，由 TTL 与后续请求自愈。 */
  private async writeMenuCacheQuietly(
    cacheKey: string,
    menu: ClubMenuStaticResponse,
  ): Promise<void> {
    try {
      await this.redisService.setJson(
        cacheKey,
        menu,
        CLUB_MENU_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `回填菜单缓存失败 cacheKey=${cacheKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 取门店菜单版本：命中短 TTL 缓存时直接返回，未命中才执行四层 JOIN。
   *
   * 菜单是 C 端最高频读，而版本计算是其中唯一无法被菜单缓存覆盖的一步
   * （要先有版本才能拼出缓存 key）。缓存后常态下整条菜单请求不再查库。
   * Redis 不可用（读失败/写失败）时静默降级为每次重算，行为与改造前一致。
   */
  private async resolveMenuVersion(storeId: number): Promise<string> {
    const versionKey = buildClubMenuVersionCacheKey(storeId);
    try {
      const cached = await this.redisService.get(versionKey);
      if (cached) return cached;
    } catch (error) {
      this.logger.warn(
        `读取菜单版本缓存失败 storeId=${storeId}，回退实时计算: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const menuVersion = await this.computeMenuVersion(storeId);

    // 非关键路径：回填失败只影响下次是否命中，不改变本次结果
    void this.backfillMenuVersionCache(storeId, versionKey, menuVersion);

    return menuVersion;
  }

  /** fire-and-forget 回填菜单版本缓存，失败仅记录日志。 */
  private async backfillMenuVersionCache(
    storeId: number,
    versionKey: string,
    menuVersion: string,
  ): Promise<void> {
    try {
      await this.redisService.set(
        versionKey,
        menuVersion,
        CLUB_MENU_VERSION_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `回填菜单版本缓存失败 storeId=${storeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 计算门店菜单版本（**静态**内容指纹）。
   *
   * 语义：这份版本必须是内容指纹，不能换成写路径 INCR 的计数器——一旦某个写
   * 路径漏挂失效，计数器会长期把旧价格发给顾客；内容指纹在下一个请求自愈。
   *
   * ⚠️ 指纹**刻意不包含任何每单都会变的列**（`version` / `reserved_quantity` /
   * `stock_quantity` / `sales_count`）。库存预留会 `version + 1`，若版本进指纹，
   * 一笔下单就让整店菜单缓存 key 轮换，全店在线顾客同时 miss 并各自回源四层
   * JOIN —— 这是被改掉的击穿点。库存/销量改由
   * `ClubScanOrderingMenuStockService` 的 5s 快照覆盖，与 menuVersion 解耦。
   *
   * 进了指纹的是「改了就必须换菜单」的列：价格、上下架、库存模式、关联商品、
   * 名称/图片/排序、规格组与规格项的结构与加价。改价后下一次请求即换 key，
   * 不依赖任何写路径挂失效钩子。
   *
   * 性能：四层 JOIN 仍在库里完成，但**只回 1 行**（md5 摘要），不再把整店菜单
   * 行拉回 Node 做 JSON.stringify + sha256。`string_agg(... ORDER BY ...)` 保证
   * 指纹不受执行计划影响（否则版本会无故抖动，导致菜单缓存被无意义重建）。
   * md5 在此仅作缓存指纹，不承载任何安全语义。
   */
  private async computeMenuVersion(storeId: number): Promise<string> {
    const [row] = await this.prisma.$queryRaw<MenuVersionFingerprintRow[]>`
      SELECT md5(COALESCE(string_agg(
        concat_ws(':',
          c."id", c."name", c."sort_order",
          p."id", p."name", p."base_price", COALESCE(p."image_url", '-'),
          p."stock_mode", COALESCE(p."product_id"::text, '-'),
          p."is_active", p."sort_order",
          COALESCE(g."id"::text, '-'), COALESCE(g."name", '-'),
          COALESCE(g."selection_type"::text, '-'),
          COALESCE(g."min_selections"::text, '-'),
          COALESCE(g."max_selections"::text, '-'),
          COALESCE(o."id"::text, '-'), COALESCE(o."name", '-'),
          COALESCE(o."extra_price"::text, '-'),
          COALESCE(o."is_default"::text, '-'), COALESCE(o."is_active"::text, '-')
        ),
        ',' ORDER BY
          c."sort_order" ASC, c."id" ASC,
          p."sort_order" ASC, p."id" ASC,
          g."sort_order" ASC NULLS FIRST, g."id" ASC NULLS FIRST,
          o."sort_order" ASC NULLS FIRST, o."id" ASC NULLS FIRST
      ), '')) AS "fingerprint"
      FROM "scan_ordering_menu_categories" AS c
      -- INNER JOIN 已排除「无任何未删除商品」的分类，等价于原
      -- products: { some: { deletedAt: null } } 过滤
      JOIN "scan_ordering_menu_products" AS p
        ON p."category_id" = c."id" AND p."deleted_at" IS NULL
      LEFT JOIN "scan_ordering_spec_groups" AS g
        ON g."menu_product_id" = p."id" AND g."is_active" = true
      LEFT JOIN "scan_ordering_spec_options" AS o
        ON o."group_id" = g."id" AND o."is_active" = true
      WHERE c."store_id" = ${storeId}
        AND c."is_active" = true
        AND c."deleted_at" IS NULL
    `;
    // 聚合查询恒返回 1 行（空菜单也已由 COALESCE 兜成空串的 md5）
    return row.fingerprint;
  }
}
