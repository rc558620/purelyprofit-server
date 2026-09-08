import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { assertGeneralStoreForSelfOrdering } from './club-self-ordering.utils';

/** 菜单商品：与前端 ScanOrderingMenuProduct 同构（specGroups 恒为空数组，非餐饮商品无规格） */
export interface SelfOrderingMenuProductDto {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** 售价（分） */
  basePrice: number;
  stockMode: 'unlimited';
  stockQuantity: null;
  salesCount: number;
  specGroups: never[];
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
 * P0 决策：不做库存与售罄态（空间场景默认不敏感），全部按 unlimited 返回；
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
          updatedAt: true,
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
      stockMode: 'unlimited',
      stockQuantity: null,
      salesCount: 0,
      specGroups: [],
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

    // menuVersion 取商品最大更新时间，前端据此做缓存失效判断
    const menuVersion =
      products.length > 0
        ? `v${Math.max(...products.map((p) => p.updatedAt.getTime()))}`
        : 'empty';

    return { menuVersion, categories: resultCategories };
  }
}
