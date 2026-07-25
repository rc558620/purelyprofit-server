import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { CreateScanOrderingMenuCategoryDto } from './dto/scan-ordering-menu.dto';

/** 商家扫码点餐菜单分类响应。 */
export interface ScanOrderingMenuCategoryResponse {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  products: any[]; // 留空或后续扩展
}

/**
 * 商家扫码点餐菜单分类管理服务。
 */
@Injectable()
export class ScanOrderingMenuCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async createCategory(
    user: AuthenticatedUser,
    dto: CreateScanOrderingMenuCategoryDto,
  ): Promise<ScanOrderingMenuCategoryResponse> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const existingCategory =
      await this.prisma.scanOrderingMenuCategory.findUnique({
        where: { storeId_name: { storeId, name: dto.name } },
        select: { id: true },
      });
    if (existingCategory) {
      throw new ConflictException('扫码点餐菜单分类已存在');
    }

    const category = await this.prisma.scanOrderingMenuCategory.create({
      data: { storeId, name: dto.name, sortOrder: dto.sortOrder ?? 0 },
    });

    return {
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      products: [],
    };
  }

  async updateCategory(
    user: AuthenticatedUser,
    categoryId: number,
    dto: import('./dto/scan-ordering-category-update.dto').UpdateScanOrderingMenuCategoryDto,
  ): Promise<void> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const result = await this.prisma.scanOrderingMenuCategory.updateMany({
      where: { id: categoryId, storeId },
      data: dto,
    });

    if (result.count === 0)
      throw new NotFoundException('扫码点餐菜单分类不存在');
  }

  async removeCategory(
    user: AuthenticatedUser,
    categoryId: number,
  ): Promise<void> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const productCount = await this.prisma.scanOrderingMenuProduct.count({
      where: { storeId, categoryId, deletedAt: null },
    });

    if (productCount > 0)
      throw new ConflictException('菜单分类仍包含商品，无法删除');

    const result = await this.prisma.scanOrderingMenuCategory.deleteMany({
      where: { id: categoryId, storeId },
    });

    if (result.count === 0)
      throw new NotFoundException('扫码点餐菜单分类不存在');
  }

  private async resolveEnabledStoreId(
    user: AuthenticatedUser,
    permission: 'scan-ordering:view' | 'scan-ordering:menu-manage',
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      permission,
      '无权操作扫码点餐菜单',
    );
  }
}
