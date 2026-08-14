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

    // 预留库存保护：新设置的总库存不能小于已下单未接单的预留量，
    // 否则会导致可用库存（总库存 - 预留量）为负数。
    if (dto.stockMode === 'finite') {
      const current = await this.prisma.scanOrderingMenuProduct.findUnique({
        where: { id: productId },
        select: { reservedQuantity: true },
      });
      const reserved = current?.reservedQuantity ?? 0;
      if (dto.stockQuantity! < reserved) {
        throw new ConflictException(
          `库存不能低于已预留数量 ${reserved}，请先处理相关订单`,
        );
      }
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
