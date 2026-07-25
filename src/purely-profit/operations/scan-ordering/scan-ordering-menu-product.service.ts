import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type {
  CreateScanOrderingMenuProductDto,
  UpdateScanOrderingMenuProductAvailabilityDto,
} from './dto/scan-ordering-menu.dto';
import type { UpdateScanOrderingMenuProductDto } from './dto/scan-ordering-menu-update.dto';

/** 商家扫码点餐菜单商品响应。 */
export interface ScanOrderingMenuProductResponse {
  id: number;
  name: string;
  basePrice: number;
  isActive: boolean;
  stockMode: 'unlimited' | 'finite' | 'sold_out';
  stockQuantity: number | null;
  sortOrder: number;
}

/**
 * 商家扫码点餐菜单商品管理服务。
 */
@Injectable()
export class ScanOrderingMenuProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async createProduct(
    user: AuthenticatedUser,
    dto: CreateScanOrderingMenuProductDto,
  ): Promise<ScanOrderingMenuProductResponse> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const category = await this.prisma.scanOrderingMenuCategory.findFirst({
      where: { id: dto.categoryId, storeId },
      select: { id: true },
    });

    if (!category) throw new NotFoundException('扫码点餐菜单分类不存在');
    if (dto.stockMode === 'finite' && dto.stockQuantity === undefined) {
      throw new ConflictException('有限库存商品必须提供库存数量');
    }

    const product = await this.prisma.scanOrderingMenuProduct.create({
      data: {
        storeId,
        categoryId: dto.categoryId,
        name: dto.name,
        basePrice: Money.fromInputYuan(dto.basePrice).toDbCents(),
        stockMode: dto.stockMode ?? 'unlimited',
        stockQuantity: dto.stockMode === 'finite' ? dto.stockQuantity : null,
      },
    });

    return {
      id: product.id,
      name: product.name,
      basePrice: Money.fromDbCents(product.basePrice).toOutputYuan(),
      isActive: product.isActive,
      stockMode: product.stockMode,
      stockQuantity: product.stockQuantity,
      sortOrder: product.sortOrder,
    };
  }

  async updateProduct(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateScanOrderingMenuProductDto,
  ): Promise<void> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const result = await this.prisma.scanOrderingMenuProduct.updateMany({
      where: { id: productId, storeId, deletedAt: null },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.basePrice !== undefined
          ? { basePrice: Money.fromInputYuan(dto.basePrice).toDbCents() }
          : {}),
        version: { increment: 1 },
      },
    });

    if (result.count === 0) throw new NotFoundException('扫码点餐商品不存在');
  }

  async removeProduct(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<void> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const result = await this.prisma.scanOrderingMenuProduct.updateMany({
      where: { id: productId, storeId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        isActive: false,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) throw new NotFoundException('扫码点餐商品不存在');
  }

  async updateAvailability(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateScanOrderingMenuProductAvailabilityDto,
  ): Promise<void> {
    const storeId = await this.resolveEnabledStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const result = await this.prisma.scanOrderingMenuProduct.updateMany({
      where: { id: productId, storeId, deletedAt: null },
      data: { isActive: dto.isActive, version: { increment: 1 } },
    });

    if (result.count === 0) throw new NotFoundException('扫码点餐商品不存在');
  }

  private async resolveEnabledStoreId(
    user: AuthenticatedUser,
    permission: string,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      permission as any,
      '无权操作扫码点餐菜单',
    );
  }
}
