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
  CreateScanOrderingSpecGroupDto,
  CreateScanOrderingSpecOptionDto,
} from './dto/scan-ordering-spec.dto';
import type {
  UpdateScanOrderingSpecGroupDto,
  UpdateScanOrderingSpecOptionDto,
} from './dto/scan-ordering-menu-update.dto';
import type { UpdateScanOrderingProductStockDto } from './dto/scan-ordering-product-stock.dto';

/**
 * 商家扫码点餐菜单规格管理服务。
 */
@Injectable()
export class ScanOrderingMenuSpecService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async createSpecGroup(
    user: AuthenticatedUser,
    productId: number,
    dto: CreateScanOrderingSpecGroupDto,
  ): Promise<number> {
    const storeId = await this.resolveStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const product = await this.prisma.scanOrderingMenuProduct.findFirst({
      where: { id: productId, storeId, deletedAt: null },
      select: { id: true },
    });

    if (!product) throw new NotFoundException('扫码点餐商品不存在');

    const group = await this.prisma.scanOrderingSpecGroup.create({
      data: {
        menuProductId: productId,
        name: dto.name,
        selectionType: dto.selectionType ?? 'single',
      },
      select: { id: true },
    });

    return group.id;
  }

  async createSpecOption(
    user: AuthenticatedUser,
    groupId: number,
    dto: CreateScanOrderingSpecOptionDto,
  ): Promise<number> {
    const storeId = await this.resolveStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const group = await this.prisma.scanOrderingSpecGroup.findFirst({
      where: { id: groupId, product: { is: { storeId, deletedAt: null } } },
      select: { id: true },
    });

    if (!group) throw new NotFoundException('扫码点餐规格组不存在');

    const option = await this.prisma.scanOrderingSpecOption.create({
      data: {
        groupId,
        name: dto.name,
        extraPrice: Money.fromInputYuan(dto.extraPrice ?? 0).toDbCents(),
        stockQuantity: dto.stockQuantity,
      },
      select: { id: true },
    });

    return option.id;
  }

  async updateSpecGroup(
    user: AuthenticatedUser,
    groupId: number,
    dto: UpdateScanOrderingSpecGroupDto,
  ): Promise<void> {
    const storeId = await this.resolveStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const result = await this.prisma.scanOrderingSpecGroup.updateMany({
      where: { id: groupId, product: { is: { storeId, deletedAt: null } } },
      data: dto,
    });

    if (result.count === 0) throw new NotFoundException('扫码点餐规格组不存在');
  }

  async removeSpecGroup(
    user: AuthenticatedUser,
    groupId: number,
  ): Promise<void> {
    const storeId = await this.resolveStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const result = await this.prisma.scanOrderingSpecGroup.deleteMany({
      where: { id: groupId, product: { is: { storeId, deletedAt: null } } },
    });

    if (result.count === 0) throw new NotFoundException('扫码点餐规格组不存在');
  }

  async updateSpecOption(
    user: AuthenticatedUser,
    optionId: number,
    dto: UpdateScanOrderingSpecOptionDto,
  ): Promise<void> {
    const storeId = await this.resolveStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const result = await this.prisma.scanOrderingSpecOption.updateMany({
      where: {
        id: optionId,
        group: { is: { product: { is: { storeId, deletedAt: null } } } },
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.extraPrice !== undefined
          ? { extraPrice: Money.fromInputYuan(dto.extraPrice).toDbCents() }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.stockQuantity !== undefined
          ? { stockQuantity: dto.stockQuantity }
          : {}),
      },
    });

    if (result.count === 0) throw new NotFoundException('扫码点餐规格项不存在');
  }

  async removeSpecOption(
    user: AuthenticatedUser,
    optionId: number,
  ): Promise<void> {
    const storeId = await this.resolveStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    const result = await this.prisma.scanOrderingSpecOption.deleteMany({
      where: {
        id: optionId,
        group: { is: { product: { is: { storeId, deletedAt: null } } } },
      },
    });

    if (result.count === 0) throw new NotFoundException('扫码点餐规格项不存在');
  }

  private async resolveStoreId(
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
