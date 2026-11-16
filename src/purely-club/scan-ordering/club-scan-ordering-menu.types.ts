import type { Prisma } from '@prisma/client';

/**
 * 菜单读投影：只取 purelyClub 运行时真正读取的字段。
 *
 * 白名单按「响应实际消费字段」逐字段取证后确定（purelyClub 侧唯一读取点是
 * `pages/orderPkg/menu/menu.mapper.ts:13-38`，页面/组件只消费映射后的前端模型
 * `types/orderPkg.ts`，本地缓存 `keyedTTLResourceStore` 存的是映射后模型，
 * 不保留原始行字段）：
 *  - category: `id / name / sortOrder / products`（与前端 `ScanOrderingMenuCategory`
 *    声明完全一致）。`storeId / isActive / version / createdAt / updatedAt /
 *    deletedAt` 在 C 端全仓零命中，且 `storeId` 与 `isActive` 已由 `where` 收敛。
 *  - menuProduct: `id / categoryId / name / description / imageUrl / basePrice /
 *    stockMode / stockQuantity / salesCount` + 内部派生用的 `reservedQuantity`、
 *    关联商品 `product.stock / product.image`（决定 `stockMode` 是否降级为
 *    `finite`、以及 `imageUrl` 的兜底）。`isRecommended / availableFrom /
 *    availableTo / sortOrder / isActive / version / 三个时间戳 / productId`
 *    在 C 端零命中；排序由 `orderBy` 保证，不依赖投影列。
 *  - specGroup: `id / name / selectionType / minSelections / maxSelections`。
 *    `menuProductId / sortOrder / isActive / version / 时间戳` 零命中。
 *  - specOption: `id / name / extraPrice / isDefault / isActive` + 内部派生用的
 *    `stockQuantity / reservedQuantity`。`groupId / sortOrder / version /
 *    时间戳` 零命中。
 *
 * 实测收益（本地库 store 37：22 分类 / 109 商品 / 13 规格组 / 42 规格项，按
 * `pg_column_size` 汇总）：整行 20,501 B → 白名单 10,222 B（-50.1%）。这份数据
 * 同时是菜单 30s 缓存 value 的体积，Redis 内存与网络往返同比例下降。
 *
 * ⚠️ 前端读取的是 Prisma 列名直出（`basePrice / extraPrice / selectionType /
 * minSelections / maxSelections`），不是 `price / priceDelta / required /
 * minSelect / maxSelect`——改这张白名单时必须按真实列名，否则价格会变 NaN、
 * 规格弹窗失效。
 *
 * ⚠️ `reservedQuantity` 必须留在 select 里参与可用库存计算，但**不进响应**：
 * 响应由 service 的 `mapXxx` 显式构造（不再整行 spread），避免内部字段重新泄漏。
 */
export const CLUB_MENU_CATEGORY_SELECT = {
  id: true,
  name: true,
  sortOrder: true,
  products: {
    where: { isActive: true, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      categoryId: true,
      name: true,
      description: true,
      imageUrl: true,
      basePrice: true,
      stockMode: true,
      stockQuantity: true,
      reservedQuantity: true,
      salesCount: true,
      product: { select: { stock: true, image: true } },
      specGroups: {
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          selectionType: true,
          minSelections: true,
          maxSelections: true,
          options: {
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              name: true,
              extraPrice: true,
              stockQuantity: true,
              reservedQuantity: true,
              isDefault: true,
              isActive: true,
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.ScanOrderingMenuCategorySelect;

export type ClubMenuCategoryRow = Prisma.ScanOrderingMenuCategoryGetPayload<{
  select: typeof CLUB_MENU_CATEGORY_SELECT;
}>;
export type ClubMenuProductRow = ClubMenuCategoryRow['products'][number];
export type ClubMenuSpecGroupRow = ClubMenuProductRow['specGroups'][number];
export type ClubMenuSpecOptionRow = ClubMenuSpecGroupRow['options'][number];

export interface ClubMenuSpecOption {
  id: number;
  name: string;
  extraPrice: number;
  isDefault: boolean;
  isActive: boolean;
  stockQuantity: number | null;
}

export interface ClubMenuSpecGroup {
  id: number;
  name: string;
  selectionType: ClubMenuSpecGroupRow['selectionType'];
  minSelections: number;
  maxSelections: number | null;
  options: ClubMenuSpecOption[];
}

export interface ClubMenuProduct {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: number;
  stockMode: ClubMenuProductRow['stockMode'];
  stockQuantity: number;
  salesCount: number;
  specGroups: ClubMenuSpecGroup[];
}

export interface ClubMenuCategory {
  id: number;
  name: string;
  sortOrder: number;
  products: ClubMenuProduct[];
}

/**
 * 菜单对外响应。
 *
 * `menuVersion` 保留：purelyClub 只解构 `.categories`（`menu.data.ts:19`），运行
 * 时不读该值，但前端类型声明为非可选，且成本仅 32 字节——删除需要同步改前端
 * 类型而收益≈0，因此按契约保留。
 */
export interface ClubMenuResponse {
  menuVersion: string;
  categories: ClubMenuCategory[];
}
