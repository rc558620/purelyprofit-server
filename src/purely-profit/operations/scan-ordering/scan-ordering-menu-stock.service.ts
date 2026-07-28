import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PermissionCode } from '../../access-control/access-control.constants';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { UpdateScanOrderingProductStockDto } from './dto/scan-ordering-product-stock.dto';

/**
 * 商家扫码点餐商品库存管理服务。
 */
@Injectable()
export class ScanOrderingMenuStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async updateProductStock(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateScanOrderingProductStockDto,
  ): Promise<void> {
    const storeId = await this.resolveStoreId(
      user,
      'scan-ordering:menu-manage',
    );

    if (dto.stockMode === 'finite' && dto.stockQuantity === undefined) {
      throw new ConflictException('有限库存商品必须提供库存数量');
    }

    const result = await this.prisma.scanOrderingMenuProduct.updateMany({
      where: { id: productId, storeId, deletedAt: null },
      data: {
        stockMode: dto.stockMode,
        stockQuantity: dto.stockMode === 'finite' ? dto.stockQuantity : null,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('扫码点餐商品不存在');
    }
  }

  private async resolveStoreId(
    user: AuthenticatedUser,
    permission: PermissionCode,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      permission,
      '无权操作扫码点餐菜单',
    );
  }
}
