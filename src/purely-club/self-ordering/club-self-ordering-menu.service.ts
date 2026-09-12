import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { assertGeneralStoreForSelfOrdering } from './club-self-ordering.utils';

/** 规格选项（金额单位为分） */
export interface SelfOrderingMenuSpecOptionDto {
  id: number;
  name: string;
  /** 相对基准价加价（分） */
  extraPrice: number;
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
  constructor(
    private readonly prisma: PrismaService,
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

    // 与建单同一道会话门禁：必须先扫码定位到 active 会话才能看菜单
    const session = await this.prisma.spaceSession.findFirst({
      where: { id: sessionId, storeId, status: 'active' },
      select: { id: true },
    });
    if (!session) {
      throw new ForbiddenException('当前空间会话不可用，请重新扫码');
    }

    const [categories, products] = await Promise.all([
      this.prisma.productCategory.findMany({
        where: { storeId, deletedAt: null },
        orderBy: { id: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.product.findMany({
        where: { storeId, isActive: true, deletedAt: null },
        orderBy: { id: 'asc' },
        select: {
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
                      isActive: true,
                      updatedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const toMenuProduct = (
      product: (typeof products)[number],
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
          selectionType:
            group.selectionType === 'multiple' ? 'multiple' : 'single',
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          sortOrder: group.sortOrder,
          options: group.options.map((option) => ({
            id: option.id,
            name: option.name,
            extraPrice: option.extraPrice,
            isActive: option.isActive,
            stockQuantity: null,
          })),
        }),
      ),
    });

    const categoryMap = new Map(categories.map((c) => [c.id, c]));
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

    // 只返回有商品的分类，避免左栏出现空 Tab；无归属商品归入「其他」兜底分类
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

    // menuVersion 取「商品 / 规格组 / 规格选项」的最大更新时间，前端据此做缓存失效判断。
    // 规格变更不会改动商品 updatedAt，只取商品会表现为「改了规格不生效」；
    // 额外计入组数与选项数，用于覆盖新增/删除（删除不留 updatedAt）。
    let specGroupCount = 0;
    let specOptionCount = 0;
    let specMaxUpdatedAt = 0;
    for (const product of products) {
      for (const group of product.scanOrderingMenuProducts?.[0]?.specGroups ??
        []) {
        specGroupCount += 1;
        specMaxUpdatedAt = Math.max(
          specMaxUpdatedAt,
          group.updatedAt.getTime(),
        );
        for (const option of group.options) {
          specOptionCount += 1;
          specMaxUpdatedAt = Math.max(
            specMaxUpdatedAt,
            option.updatedAt.getTime(),
          );
        }
      }
    }
    const productMaxUpdatedAt =
      products.length > 0
        ? Math.max(...products.map((p) => p.updatedAt.getTime()))
        : 0;
    const menuVersion =
      products.length > 0
        ? `v${Math.max(productMaxUpdatedAt, specMaxUpdatedAt)}:${specGroupCount}:${specOptionCount}`
        : 'empty';

    return { menuVersion, categories: resultCategories };
  }
}
