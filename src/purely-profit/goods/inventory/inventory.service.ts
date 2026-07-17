import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import type {
  InventoryAdjustmentResponseDto,
  ProductThresholdResponseDto,
} from './dto/inventory.dto';
import {
  buildInventoryAdjustmentResponse,
  buildProductThresholdResponse,
} from './inventory.mapper';
import {
  findInventoryProductStore,
  updateInventoryAlertThresholdRecord,
} from './inventory.query';
import {
  executeInventoryManualAdjustment,
  recordInventoryRestock,
  recordInventorySaleDeduction,
  revertInventorySaleDeduction,
} from './inventory-stock.query';
import type {
  AdjustInventoryInput,
  InventoryRestockParams,
  InventoryRevertSaleParams,
  InventorySaleDeductionParams,
  UpdateAlertThresholdInput,
} from './inventory.types';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly productsService: ProductsService,
  ) {}

  async removeProduct(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<void> {
    await this.productsService.remove(user, productId);
  }

  async adjust(
    user: AuthenticatedUser,
    dto: AdjustInventoryInput,
  ): Promise<InventoryAdjustmentResponseDto> {
    const requiredPermission = this.resolveAdjustPermission(dto);
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      requiredPermission,
      '无权操作该门店库存',
    );
    const operatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );
    const mode = dto.mode ?? (dto.targetStock !== undefined ? 'set' : 'delta');

    /* BUG-9: delta 和 targetStock 互斥校验 */
    if (dto.delta !== undefined && dto.targetStock !== undefined) {
      throw new BadRequestException('delta 和 targetStock 不能同时传入');
    }

    /* BUG-5 修复：delta 与 targetStock 至少传一个；delta 模式要求 delta≠0 */
    if (mode === 'delta' && (dto.delta === undefined || dto.delta === 0)) {
      throw new BadRequestException(
        '增减模式下必须传非零的 delta，或直接传 targetStock 设置目标库存',
      );
    }

    /* BUG-10: damage 类型强制要求备注 */
    if (dto.adjustType === 'damage' && !dto.note?.trim()) {
      throw new BadRequestException('报损类型必须填写备注说明');
    }

    const adjustment = await this.prisma.$transaction((transaction) =>
      executeInventoryManualAdjustment(transaction, {
        storeId,
        productId: dto.productId,
        operatorStaffId,
        delta: dto.delta,
        targetStock: dto.targetStock,
        mode,
        adjustType: dto.adjustType,
        note: dto.note?.trim() ? dto.note.trim() : undefined,
      }),
    );

    return buildInventoryAdjustmentResponse(adjustment);
  }

  async updateAlertThreshold(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateAlertThresholdInput,
  ): Promise<ProductThresholdResponseDto> {
    /*
     * BUG-3 修复：
     * 1. findInventoryProductStore 加 deletedAt: null 过滤软删除商品
     * 2. 权限校验前置，避免无权限用户面对已下架商品时拿到业务错误而非权限错误
     */
    const product = await findInventoryProductStore(this.prisma, productId);

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'inventory:update',
      '无权操作该门店库存',
    );

    if (!product.isActive) {
      throw new BadRequestException('已下架商品不允许修改预警阈值');
    }

    const updated = await updateInventoryAlertThresholdRecord(
      this.prisma,
      product.id,
      dto.threshold,
    );

    return buildProductThresholdResponse(updated);
  }

  async recordPurchaseRestock(
    transaction: Prisma.TransactionClient,
    params: InventoryRestockParams,
  ): Promise<void> {
    await recordInventoryRestock(transaction, params);
  }

  async recordSaleDeduction(
    transaction: Prisma.TransactionClient,
    params: InventorySaleDeductionParams,
  ): Promise<void> {
    await recordInventorySaleDeduction(transaction, params);
  }

  async revertSaleDeduction(
    transaction: Prisma.TransactionClient,
    params: InventoryRevertSaleParams,
  ): Promise<void> {
    await revertInventorySaleDeduction(transaction, params);
  }

  private resolveAdjustPermission(
    dto: AdjustInventoryInput,
  ): 'inventory:update' | 'operation-entry:create' {
    const mode = dto.mode ?? (dto.targetStock !== undefined ? 'set' : 'delta');
    const isOperationEntryDeduction =
      dto.adjustType === 'manual' && mode === 'delta' && (dto.delta ?? 0) < 0;

    return isOperationEntryDeduction
      ? 'operation-entry:create'
      : 'inventory:update';
  }
}
