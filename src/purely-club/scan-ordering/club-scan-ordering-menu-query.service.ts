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

const CLUB_MENU_CACHE_TTL_SECONDS = 30;
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
  private readonly inflightMenuLoads = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /** 失效门店菜单版本缓存：菜单写路径（改价/上下架/库存预留）调用。 */
  async invalidateMenuVersion(storeId: number): Promise<void> {
    try {
      await this.redisService.del(buildClubMenuVersionCacheKey(storeId));
    } catch (error) {
      // 缓存失效失败不影响主流程：版本缓存有短 TTL 兜底
      this.logger.warn(
        `失效菜单版本缓存失败 storeId=${storeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getMenu(user: AuthenticatedUser, sessionId: number): Promise<unknown> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: sessionId,
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
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
    let cached: unknown = null;
    try {
      cached = await this.redisService.getJson<unknown>(cacheKey);
    } catch (error) {
      this.logger.warn(
        `读取菜单缓存失败 cacheKey=${cacheKey}，回退实时菜单: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (cached) {
      return cached;
    }

    // 未命中：菜单变更或缓存过期时，同一 key 的并发请求共用一次回源，
    // 避免四层 JOIN 被放大 N 倍。进程内去重，集群下最多放大到 worker 数。
    return this.loadMenuOnce(cacheKey, () =>
      this.buildMenu(session.storeId, menuVersion, cacheKey),
    );
  }

  /** 未命中路径的并发去重（singleflight）；不改变既有缓存 value 格式。 */
  private loadMenuOnce(
    cacheKey: string,
    load: () => Promise<unknown>,
  ): Promise<unknown> {
    const inflight = this.inflightMenuLoads.get(cacheKey);
    if (inflight) return inflight;
    const task = load().finally(() => {
      this.inflightMenuLoads.delete(cacheKey);
    });
    this.inflightMenuLoads.set(cacheKey, task);
    return task;
  }

  /** 未命中时回源组装完整菜单，并回填短 TTL 缓存。 */
  private async buildMenu(
    storeId: number,
    menuVersion: string,
    cacheKey: string,
  ): Promise<unknown> {
    const categories = await this.prisma.scanOrderingMenuCategory.findMany({
      where: {
        storeId,
        isActive: true,
        deletedAt: null,
        products: { some: { deletedAt: null } },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        products: {
          where: { isActive: true, deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: {
            product: {
              select: {
                stock: true,
                image: true,
                isActive: true,
                deletedAt: true,
              },
            },
            specGroups: {
              where: { isActive: true },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              include: {
                options: {
                  where: { isActive: true },
                  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                },
              },
            },
          },
        },
      },
    });
    const result = {
      menuVersion,
      categories: categories.map((category) => ({
        ...category,
        products: category.products.map((product) => {
          const baseStock = product.product
            ? product.product.stock
            : (product.stockQuantity ?? 0);
          return {
            ...product,
            imageUrl: product.product?.image ?? product.imageUrl,
            stockMode: product.product ? 'finite' : product.stockMode,
            // 可用库存 = 总库存 - 已下单未接单的预留量
            stockQuantity: Math.max(
              0,
              baseStock - (product.reservedQuantity ?? 0),
            ),
            // 规格可用库存同样扣除预留量
            specGroups: product.specGroups.map((group) => ({
              ...group,
              options: group.options.map((option) => ({
                ...option,
                stockQuantity:
                  option.stockQuantity === null
                    ? null
                    : Math.max(
                        0,
                        option.stockQuantity - (option.reservedQuantity ?? 0),
                      ),
              })),
            })),
            product: undefined,
          };
        }),
      })),
    };

    await this.writeMenuCacheQuietly(cacheKey, result);

    return result;
  }

  /** 回填菜单缓存：写失败不影响本次返回，由短 TTL 与后续请求自愈。 */
  private async writeMenuCacheQuietly(
    cacheKey: string,
    menu: unknown,
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
   * 计算门店菜单版本（内容指纹）。
   *
   * 语义：这份版本必须是**内容指纹**，不能换成写路径 INCR 的计数器。
   * 它是菜单缓存 key 的组成部分（见 buildClubMenuCacheKey），一旦某个写路径
   * 漏挂失效，计数器版本会长期把旧价格/旧库存发给顾客；而内容指纹在下一个
   * 请求就会自愈。因此这里保持「按内容算」，不改成 bump。
   *
   * 参与指纹的维度：分类 / 商品的 id + version + 上下架 + 规格组 / 规格项的
   * id + version。商品与规格维度**必须**进指纹：改价、库存预留（下单即 bump
   * 商品 version）、上下架、规格增减都只 bump 商品/规格的 version，不动分类
   * version；若只按分类算，这些最高频的变更不会改变 menuVersion。
   *
   * 性能：四层 JOIN 仍在库里完成，但**只回 1 行**（md5 摘要），不再把整店菜单
   * 行拉回 Node 做 JSON.stringify + sha256 —— 300 商品的店每次重算要传输上千行，
   * 而真正需要的只有摘要。`string_agg(... ORDER BY ...)` 保证指纹不受执行计划
   * 影响（否则版本会无故抖动，导致菜单缓存被无意义重建）。md5 在此仅作缓存
   * 指纹，不承载任何安全语义。
   *
   * ⚠️ 指纹取值与旧版「JS 侧 sha256(JSON.stringify(行))」不同：menuVersion 只进
   * 缓存 key（菜单 30s、版本 10s），且 purelyClub / purelyProfit / purelyPulse
   * 均未解析或比较该字段（实测只有类型声明），切换后旧 key 自然过期。
   */
  private async computeMenuVersion(storeId: number): Promise<string> {
    const [row] = await this.prisma.$queryRaw<MenuVersionFingerprintRow[]>`
      SELECT md5(COALESCE(string_agg(
        concat_ws(':',
          c."id", c."version",
          p."id", p."version", p."is_active",
          COALESCE(g."id"::text, '-'), COALESCE(g."version"::text, '-'),
          COALESCE(o."id"::text, '-'), COALESCE(o."version"::text, '-')
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
