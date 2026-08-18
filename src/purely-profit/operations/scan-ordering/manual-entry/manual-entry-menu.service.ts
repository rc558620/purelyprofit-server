// 录入订单菜单聚合服务：按门店聚合在售分类、商品、规格组与可用库存，供商家端选品组单

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { Money } from '../../../../shared/money.utils';
import { CommerceAccessService } from '../../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../../auth/strategies/jwt.strategy';
import type {
  ManualEntryCategoryResponse,
  ManualEntryMenuResponse,
} from './manual-entry.types';

/** 录入订单菜单聚合服务（只读，不含菜单管理写操作）。 */
@Injectable()
export class ManualEntryMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 拉取门店在售菜单（含规格组/选项与可用库存），仅返回 isActive 的分类与商品。 */
  async listMenu(user: AuthenticatedUser): Promise<ManualEntryMenuResponse> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看录入订单菜单',
    );

    const categories = await this.prisma.scanOrderingMenuCategory.findMany({
      where: { storeId, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        products: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: {
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
            // 关联库存商品，stocktaking 中的实际库存以此为准
            product: {
              select: { stock: true },
            },
          },
        },
      },
    });

    return {
      categories: categories
        .map((category) => this.toCategoryResponse(category))
        .filter((category) => category.products.length > 0),
    };
  }

  /** 分类映射：过滤下架商品，仅保留有在售商品的分类。 */
  private toCategoryResponse(category: {
    id: number;
    name: string;
    products: Array<{
      id: number;
      name: string;
      description: string | null;
      imageUrl: string | null;
      basePrice: number;
      stockMode: string;
      stockQuantity: number | null;
      reservedQuantity: number;
      isActive: boolean;
      product: { stock: number } | null;
      specGroups: Array<{
        id: number;
        name: string;
        selectionType: 'single' | 'multiple';
        minSelections: number;
        maxSelections: number | null;
        options: Array<{
          id: number;
          name: string;
          extraPrice: number;
          isDefault: boolean;
        }>;
      }>;
    }>;
  }): ManualEntryCategoryResponse {
    return {
      id: category.id,
      name: category.name,
      products: category.products
        .filter((product) => product.isActive)
        .map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          basePrice: Money.fromDbCents(product.basePrice).toOutputYuan(),
          imageUrl: product.imageUrl || null,
          // 可用库存优先取菜单独立库存；为 null 时取关联库存商品的实际库存（stocktaking 口径）；仍为 null 表示不限量
          stockQuantity:
            product.stockQuantity !== null
              ? Math.max(
                  0,
                  product.stockQuantity - (product.reservedQuantity ?? 0),
                )
              : product.product !== null
                ? Math.max(0, product.product.stock)
                : null,
          soldOut: product.stockMode === 'sold_out',
          specGroups: product.specGroups.map((group) => ({
            id: group.id,
            name: group.name,
            selectionType: group.selectionType,
            minSelections: group.minSelections,
            maxSelections: group.maxSelections,
            options: group.options.map((option) => ({
              id: option.id,
              name: option.name,
              extraPrice: Money.fromDbCents(option.extraPrice).toOutputYuan(),
              isDefault: option.isDefault,
            })),
          })),
        })),
    };
  }
}
