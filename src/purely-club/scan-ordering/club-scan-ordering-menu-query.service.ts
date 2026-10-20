import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubMenuCacheKey } from '../../redis/keys/club-cache-keys';
import { createHash } from 'node:crypto';

const CLUB_MENU_CACHE_TTL_SECONDS = 30;

/**
 * 菜单版本扁平行。
 *
 * 四层结构（分类 → 商品 → 规格组 → 规格项）用一次 JOIN 拉平后按层级排序返回，
 * 空层级（无规格组的商品、无规格项的组）由 LEFT JOIN 产生 NULL 行表示。
 */
interface MenuVersionRow {
  categoryId: number;
  categoryVersion: number;
  productId: number;
  productVersion: number;
  productIsActive: boolean;
  groupId: number | null;
  groupVersion: number | null;
  optionId: number | null;
  optionVersion: number | null;
}

type MenuVersionOption = [number, number];
type MenuVersionGroup = [number, number, MenuVersionOption[]];
type MenuVersionProduct = [number, number, boolean, MenuVersionGroup[]];
type MenuVersionCategory = [number, number, MenuVersionProduct[]];

@Injectable()
export class ClubScanOrderingMenuQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

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
      throw new ForbiddenException('当前桌台会话不可用，请重新扫码');

    // 缓存 key 依赖 menuVersion，必须每次算（口径见 computeMenuVersion）
    const menuVersion = await this.computeMenuVersion(session.storeId);

    // 缓存命中检查：menuVersion 不变即命中
    const cacheKey = buildClubMenuCacheKey(session.storeId, menuVersion);
    const cached = await this.redisService.getJson<unknown>(cacheKey);
    if (cached) {
      return cached;
    }

    // 未命中：查完整 categories 数据
    const categories = await this.prisma.scanOrderingMenuCategory.findMany({
      where: {
        storeId: session.storeId,
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

    // 写缓存（TTL 30s，menuVersion 变更后旧 key 自然过期）
    await this.redisService.setJson(
      cacheKey,
      result,
      CLUB_MENU_CACHE_TTL_SECONDS,
    );

    return result;
  }

  /**
   * 计算门店菜单版本（sha256）。
   *
   * 轻量查询：只取 id + version 参与 hash（不拉名称/图片/金额等大字段）。
   * 商品与规格维度**必须**进 hash：改价、库存预留（下单即 bump 商品 version）、
   * 上下架、规格增删都是商品级变更，只 bump 商品/规格的 version 而不动分类 version。
   * 若只按分类计算，这些最高频的菜单变更不会改变 menuVersion → 缓存 key 不变 →
   * TTL 内持续把旧价格/旧库存返回给顾客（key 的契约见 buildClubMenuCacheKey）。
   *
   * 实现说明：原本用 Prisma 四层嵌套 select，ORM 会按层级拆成 4 条查询；
   * 这里改成一条扁平 JOIN（层级排序后由 buildMenuVersionPayload 归组），
   * 缓存命中时同样只付 1 次往返。hash 输入与嵌套写法逐字节一致
   * （同样的字段、同样的层级顺序），因此 menuVersion 取值保持兼容。
   */
  private async computeMenuVersion(storeId: number): Promise<string> {
    const rows = await this.prisma.$queryRaw<MenuVersionRow[]>`
      SELECT
        c."id"        AS "categoryId",
        c."version"   AS "categoryVersion",
        p."id"        AS "productId",
        p."version"   AS "productVersion",
        p."is_active" AS "productIsActive",
        g."id"        AS "groupId",
        g."version"   AS "groupVersion",
        o."id"        AS "optionId",
        o."version"   AS "optionVersion"
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
      ORDER BY
        c."sort_order" ASC, c."id" ASC,
        p."sort_order" ASC, p."id" ASC,
        g."sort_order" ASC, g."id" ASC,
        o."sort_order" ASC, o."id" ASC
    `;
    return createHash('sha256')
      .update(JSON.stringify(this.buildMenuVersionPayload(rows)))
      .digest('hex');
  }

  /** 把扁平行按层级归组，还原成与嵌套查询一致的 hash 输入结构。 */
  private buildMenuVersionPayload(
    rows: MenuVersionRow[],
  ): MenuVersionCategory[] {
    const categories: MenuVersionCategory[] = [];
    let category: MenuVersionCategory | null = null;
    let product: MenuVersionProduct | null = null;
    let group: MenuVersionGroup | null = null;

    for (const row of rows) {
      if (!category || category[0] !== row.categoryId) {
        category = [row.categoryId, row.categoryVersion, []];
        categories.push(category);
        product = null;
        group = null;
      }
      if (!product || product[0] !== row.productId) {
        product = [row.productId, row.productVersion, row.productIsActive, []];
        category[2].push(product);
        group = null;
      }
      if (row.groupId === null) {
        // 该商品没有启用的规格组（LEFT JOIN 未命中）
        continue;
      }
      if (!group || group[0] !== row.groupId) {
        group = [row.groupId, row.groupVersion ?? 0, []];
        product[3].push(group);
      }
      if (row.optionId !== null) {
        group[2].push([row.optionId, row.optionVersion ?? 0]);
      }
    }

    return categories;
  }
}
