import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { RedisService } from '../../../redis/redis.service';
import type { ScanOrderingMenuCategoryResponse } from './scan-ordering-menu-category.service';

/**
 * 商家扫码点餐菜单查询服务（含缓存）。
 */
@Injectable()
export class ScanOrderingMenuQueryService {
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

    const cacheKey = `scanordering:menu:${storeId}`;
    const cachedMenu =
      await this.redisService.getJson<ScanOrderingMenuCategoryResponse[]>(
        cacheKey,
      );
    if (cachedMenu) return cachedMenu;

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

    await this.redisService.set(cacheKey, JSON.stringify(menu), 300);
    return menu;
  }
}
