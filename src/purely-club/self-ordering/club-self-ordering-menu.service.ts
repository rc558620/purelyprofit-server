import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CLUB_SELF_ORDERING_ERROR_CODE,
  clubSelfOrderingError,
} from './club-self-ordering.errors';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubSelfOrderingMenuCacheKey } from '../../redis/keys/club-cache-keys';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { assertGeneralStoreForSelfOrdering } from './club-self-ordering.utils';

/** 规格选项（金额单位为分） */
export interface SelfOrderingMenuSpecOptionDto {
  id: number;
  name: string;
  /** 相对基准价加价（分） */
  extraPrice: number;
  /**
   * 是否默认选中。
   * ⚠️ 不能省略：C 端 menu.mapper 原样透传给规格弹窗，缺失会让默认预选失效，
   * 必选组打开时呈未选态（价格 ¥--、加入按钮禁用），顾客必须手动逐组点选。
   */
  isDefault: boolean;
  isActive: boolean;
  /**
   * 规格级库存：非餐饮不做（决策见 §3），恒为 null 表示不限。
   * ⚠️ 不能省略该字段——C 端 menu.mapper 用 `isActive && (stockQuantity === null || > 0)`
   * 判断选项是否可选，undefined 会让所有选项被判为售罄，「选规格」入口直接消失。
   */
  stockQuantity: null;
}

/** 规格组：与 ScanOrderingSpecGroup 同构，供 C 端规格选择弹窗消费 */
export interface SelfOrderingMenuSpecGroupDto {
  id: number;
  name: string;
  selectionType: 'single' | 'multiple';
  minSelections: number;
  /** null 表示不限选 */
  maxSelections: number | null;
  sortOrder: number;
  options: SelfOrderingMenuSpecOptionDto[];
}

/** 菜单商品：与前端 ScanOrderingMenuProduct 同构 */
export interface SelfOrderingMenuProductDto {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** 售价（分） */
  basePrice: number;
  /**
   * 库存模式：与扫码点餐同构。
   * 非餐饮商品库（Product.stock）恒有库存字段，因此恒为 finite，
   * 库存为 0 时由 C 端 menu.mapper 判定为售罄（不用 sold_out，否则 C 端会把库存当「不限」展示）。
   */
  stockMode: 'unlimited' | 'finite' | 'sold_out';
  /** 可用库存数量（取自 Product.stock） */
  stockQuantity: number | null;
  salesCount: number;
  specGroups: SelfOrderingMenuSpecGroupDto[];
}

export interface SelfOrderingMenuCategoryDto {
  id: number;
  name: string;
  sortOrder: number;
  products: SelfOrderingMenuProductDto[];
}

export interface SelfOrderingMenuResponse {
  menuVersion: string;
  categories: SelfOrderingMenuCategoryDto[];
}

/** 未分类商品的兜底分类（负数 ID 不会与真实分类冲突） */
const UNCATEGORIZED_ID = -1;
const UNCATEGORIZED_NAME = '其他';

/**
 * 自助下单菜单缓存 TTL（秒）。
 *
 * 与 C 端商品 / 扫码菜单读缓存对齐：菜单是门店级低频变更数据，30s 内的重复请求
 * （切分类、刷新、加购后重拉）直接命中。缓存只是加速层，Redis 读/写异常一律降级
 * 回源；改价 / 上下架 / 规格变更最多延迟本时长可见，但下单链路仍由服务端权威
 * 定价与库存条件更新兜底，不会按旧价成交或超卖。
 */
const CLUB_SELF_ORDERING_MENU_CACHE_TTL_SECONDS = 30;

/** 菜单商品投影：只取组装菜单所需列，规格项不下推 isActive（停用项仍需下发供前端禁用） */
const MENU_PRODUCT_SELECT = Prisma.validator<Prisma.ProductSelect>()({
  id: true,
  categoryId: true,
  name: true,
  description: true,
  image: true,
  price: true,
  stock: true,
  updatedAt: true,
  // 规格：非餐饮门店的规格同样挂在扫码菜单商品（幽灵宿主）上，与餐饮共用一张表
  scanOrderingMenuProducts: {
    where: { deletedAt: null },
    orderBy: { id: 'asc' },
    take: 1,
    select: {
      specGroups: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          selectionType: true,
          minSelections: true,
          maxSelections: true,
          sortOrder: true,
          updatedAt: true,
          options: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              name: true,
              extraPrice: true,
              isDefault: true,
              isActive: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  },
});

type MenuProductRow = Prisma.ProductGetPayload<{
  select: typeof MENU_PRODUCT_SELECT;
}>;
type MenuCategoryRow = { id: number; name: string };

const toMenuProduct = (
  product: MenuProductRow,
): SelfOrderingMenuProductDto => ({
  id: product.id,
  categoryId: product.categoryId ?? UNCATEGORIZED_ID,
  name: product.name,
  description: product.description,
  imageUrl: product.image,
  basePrice: product.price,
  stockMode: 'finite',
  // 可用库存直接取商品库库存：非餐饮无「预留量」概念，等价于扫码点餐绑定商品库的可用库存
  stockQuantity: product.stock,
  salesCount: 0,
  specGroups: (product.scanOrderingMenuProducts?.[0]?.specGroups ?? []).map(
    (group) => ({
      id: group.id,
      name: group.name,
      selectionType: group.selectionType === 'multiple' ? 'multiple' : 'single',
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      sortOrder: group.sortOrder,
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        extraPrice: option.extraPrice,
        isDefault: option.isDefault,
        isActive: option.isActive,
        stockQuantity: null,
      })),
    }),
  ),
});

/** 按分类分组；只返回有商品的分类，无归属商品归入「其他」兜底分类。 */
const assembleCategories = (
  categories: MenuCategoryRow[],
  products: MenuProductRow[],
): SelfOrderingMenuCategoryDto[] => {
  const categoryMap = new Map(
    categories.map((category) => [category.id, category]),
  );
  const grouped = new Map<number, SelfOrderingMenuProductDto[]>();
  const uncategorized: SelfOrderingMenuProductDto[] = [];

  for (const product of products) {
    const item = toMenuProduct(product);
    if (product.categoryId && categoryMap.has(product.categoryId)) {
      const bucket = grouped.get(product.categoryId) ?? [];
      bucket.push(item);
      grouped.set(product.categoryId, bucket);
    } else {
      uncategorized.push(item);
    }
  }

  const resultCategories: SelfOrderingMenuCategoryDto[] = [];
  let sortOrder = 1;
  for (const category of categories) {
    const bucket = grouped.get(category.id);
    if (!bucket || bucket.length === 0) continue;
    resultCategories.push({
      id: category.id,
      name: category.name,
      sortOrder: sortOrder++,
      products: bucket,
    });
  }
  if (uncategorized.length > 0) {
    resultCategories.push({
      id: UNCATEGORIZED_ID,
      name: UNCATEGORIZED_NAME,
      sortOrder: sortOrder++,
      products: uncategorized,
    });
  }
  return resultCategories;
};

/**
 * menuVersion 取「商品 / 规格组 / 规格选项」的最大更新时间，前端据此做缓存失效判断。
 * 规格变更不会改动商品 updatedAt，只取商品会表现为「改了规格不生效」；
 * 额外计入组数与选项数，用于覆盖新增/删除（删除不留 updatedAt）。
 *
 * 用逐行 reduce 而非 Math.max(...大数组)：商品数上千时展开参数会触发栈上限。
 */
const computeMenuVersion = (products: MenuProductRow[]): string => {
  if (products.length === 0) return 'empty';

  let maxUpdatedAt = 0;
  let specGroupCount = 0;
  let specOptionCount = 0;
  for (const product of products) {
    maxUpdatedAt = Math.max(maxUpdatedAt, product.updatedAt.getTime());
    for (const group of product.scanOrderingMenuProducts?.[0]?.specGroups ??
      []) {
      specGroupCount += 1;
      maxUpdatedAt = Math.max(maxUpdatedAt, group.updatedAt.getTime());
      for (const option of group.options) {
        specOptionCount += 1;
        maxUpdatedAt = Math.max(maxUpdatedAt, option.updatedAt.getTime());
      }
    }
  }
  return `v${maxUpdatedAt}:${specGroupCount}:${specOptionCount}`;
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 自助下单菜单查询
 *
 * 非餐饮门店的商品库（Product）直接作为菜单数据源，与空间管理「追加商品」同源，
 * 保证顾客自助下单与商家代客录入的价格口径一致。
 *
 * 库存：直接下发商品库 Product.stock（与扫码点餐绑定商品库的口径一致），
 * C 端据此展示动态库存颜色；库存为 0 时由 C 端 mapper 判为售罄。
 * 两张表均无 sortOrder，统一按 id 升序（即录入顺序）。
 */
@Injectable()
export class ClubSelfOrderingMenuService {
  private readonly logger = new Logger(ClubSelfOrderingMenuService.name);
  /** 未命中路径的进程内并发去重：同一门店共用一次回源，集群下最多放大到 worker 数。 */
  private readonly inflightMenuLoads = new Map<
    string,
    Promise<SelfOrderingMenuResponse>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly currentStoreContextService: ClubCurrentStoreContextService,
  ) {}

  async getMenu(
    user: AuthenticatedUser,
    sessionId: number,
  ): Promise<SelfOrderingMenuResponse> {
    const currentContext =
      await this.currentStoreContextService.requireCurrentContext(user);
    const storeId = currentContext.store.id;

    // 与建单/扫码同一道业态门禁：餐饮门店使用既有扫码点餐，不走商品库菜单
    assertGeneralStoreForSelfOrdering(currentContext.store);

    // 会话门禁必须实时校验，不能进缓存：会话失效后必须立刻拒绝看菜单。
    // 门禁查询与菜单缓存读取互不依赖，并行发起省一次串行往返；
    // 门禁未通过时直接抛错，缓存结果不会被返回。
    const cacheKey = buildClubSelfOrderingMenuCacheKey(storeId);
    const [session, cached] = await Promise.all([
      this.prisma.spaceSession.findFirst({
        where: { id: sessionId, storeId, status: 'active' },
        select: { id: true },
      }),
      this.readMenuCache(cacheKey),
    ]);
    if (!session) {
      throw new ForbiddenException(
        clubSelfOrderingError(
          CLUB_SELF_ORDERING_ERROR_CODE.AUTH_SESSION_UNAVAILABLE,
          '当前空间会话不可用，请重新扫码',
        ),
      );
    }
    if (cached) return cached;

    return this.loadMenuOnce(cacheKey, () => this.buildMenu(storeId, cacheKey));
  }

  /** 两条查询并行取回分类与商品；商品规格由同一份投影一次带出。 */
  private async loadMenuRows(storeId: number): Promise<{
    categories: MenuCategoryRow[];
    products: MenuProductRow[];
  }> {
    const [categories, products] = await Promise.all([
      this.prisma.productCategory.findMany({
        where: { storeId, deletedAt: null },
        orderBy: { id: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.product.findMany({
        where: { storeId, isActive: true, deletedAt: null },
        orderBy: { id: 'asc' },
        select: MENU_PRODUCT_SELECT,
      }),
    ]);
    return { categories, products };
  }

  /** 回源组装完整菜单并回填短 TTL 缓存；空菜单同样缓存，避免空门店反复回源。 */
  private async buildMenu(
    storeId: number,
    cacheKey: string,
  ): Promise<SelfOrderingMenuResponse> {
    const { categories, products } = await this.loadMenuRows(storeId);
    const menu: SelfOrderingMenuResponse = {
      menuVersion: computeMenuVersion(products),
      categories: assembleCategories(categories, products),
    };
    await this.writeMenuCacheQuietly(cacheKey, menu);
    return menu;
  }

  /** 缓存读失败一律降级回源，不能让菜单接口因 Redis 抖动而不可用。 */
  private async readMenuCache(
    cacheKey: string,
  ): Promise<SelfOrderingMenuResponse | null> {
    try {
      return await this.redisService.getJson<SelfOrderingMenuResponse>(
        cacheKey,
      );
    } catch (error) {
      this.logger.warn(
        `读取自助下单菜单缓存失败 cacheKey=${cacheKey}，回退实时查询: ${toErrorMessage(error)}`,
      );
      return null;
    }
  }

  /** 回填失败只影响下次是否命中，不改变本次结果。 */
  private async writeMenuCacheQuietly(
    cacheKey: string,
    menu: SelfOrderingMenuResponse,
  ): Promise<void> {
    try {
      await this.redisService.setJson(
        cacheKey,
        menu,
        CLUB_SELF_ORDERING_MENU_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `回填自助下单菜单缓存失败 cacheKey=${cacheKey}: ${toErrorMessage(error)}`,
      );
    }
  }

  private loadMenuOnce(
    cacheKey: string,
    load: () => Promise<SelfOrderingMenuResponse>,
  ): Promise<SelfOrderingMenuResponse> {
    const inflight = this.inflightMenuLoads.get(cacheKey);
    if (inflight) return inflight;
    const task = load().finally(() => {
      this.inflightMenuLoads.delete(cacheKey);
    });
    this.inflightMenuLoads.set(cacheKey, task);
    return task;
  }
}
