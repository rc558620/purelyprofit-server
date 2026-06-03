import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toOptionalText } from '../../commerce/commerce.utils';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/cache-invalidator.service';
import type {
  CreateSalesRecordDto,
  SalesRecordResponseDto,
} from './dto/sales-record.dto';
import { assertSalesTotalsMatch } from './sales-record.domain';
import { SalesRecordCreateFlowService } from './sales-record-create-flow.service';
import {
  SalesRecordItemPreparationService,
  type CreateSalesRecordOptions,
} from './sales-record-item-preparation.service';
import { sumMoney } from './sales-record.utils';

@Injectable()
export class SalesRecordWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly inventoryService: InventoryService,
    private readonly salesRecordItemPreparationService: SalesRecordItemPreparationService,
    private readonly salesRecordCreateFlowService: SalesRecordCreateFlowService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateSalesRecordDto,
    options: CreateSalesRecordOptions = {},
  ): Promise<SalesRecordResponseDto> {
    const storeId = options.skipAccessCheck
      ? await this.commerceAccessService.resolveSingleStoreId(
          user,
          dto.storeId,
          'operation-entry:create',
          '无权操作该门店销售记录',
        )
      : await this.commerceAccessService.resolveSingleStoreId(
          user,
          dto.storeId,
          'sales:create',
          '无权操作该门店销售记录',
        );
    const operatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    const preparedItems =
      await this.salesRecordItemPreparationService.prepareItems(
        storeId,
        dto,
        options,
      );
    const totalRevenue = sumMoney(
      preparedItems,
      (item) => item.salePrice * item.quantity,
    );
    const totalProfit = sumMoney(
      preparedItems,
      (item) => item.profit * item.quantity,
    );
    const totalQuantity = preparedItems.reduce(
      (sum, item) => sum + (item.countsTowardTotalQuantity ? item.quantity : 0),
      0,
    );

    assertSalesTotalsMatch(dto, totalRevenue, totalProfit, totalQuantity);

    const response = await this.salesRecordCreateFlowService.createRecord({
      storeId,
      operatorStaffId,
      dto,
      preparedItems,
      totalRevenue,
      totalProfit,
      totalQuantity,
      note: toOptionalText(dto.note) ?? null,
      orderDate: new Date(dto.date ?? Date.now()),
      options,
    });

    await this.invalidateStoreDerivedCaches(storeId);

    return response;
  }

  async remove(user: AuthenticatedUser, salesRecordId: number): Promise<void> {
    const record = await this.prisma.saleOrder.findUnique({
      where: { id: salesRecordId },
      select: { id: true, storeId: true },
    });

    if (!record) {
      throw new NotFoundException('销售记录不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      record.storeId,
      'sales:delete',
      '无权删除该销售记录',
    );

    await this.prisma.$transaction(async (transaction) => {
      await this.inventoryService.revertSaleDeduction(transaction, {
        storeId: record.storeId,
        saleOrderId: salesRecordId,
      });
      await transaction.financeCashFlowRecord.deleteMany({
        where: {
          storeId: record.storeId,
          saleOrderId: salesRecordId,
        },
      });
      await transaction.saleOrder.delete({
        where: { id: salesRecordId },
      });
    });

    await this.invalidateStoreDerivedCaches(record.storeId);
  }

  private async invalidateStoreDerivedCaches(storeId: number): Promise<void> {
    await this.cacheInvalidatorService.invalidateSalesDerived(storeId);
  }
}
