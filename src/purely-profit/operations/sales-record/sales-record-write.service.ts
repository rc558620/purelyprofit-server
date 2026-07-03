import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toOptionalText } from '../../commerce/commerce.utils';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import type {
  CreateSalesRecordDto,
  SalesRecordResponseDto,
} from './dto/sales-record.dto';

import { SalesRecordCreateFlowService } from './sales-record-create-flow.service';
import {
  SalesRecordItemPreparationService,
  type CreateSalesRecordOptions,
} from './sales-record-item-preparation.service';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';

@Injectable()
export class SalesRecordWriteService {
  private readonly logger = new Logger(SalesRecordWriteService.name);

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
      ? user.currentMembership
        ? await this.commerceAccessService.resolveSingleStoreId(
            user,
            dto.storeId,
            'operation-entry:create',
            '无权操作该门店销售记录',
          )
        : this.requireTrustedStoreId(dto.storeId)
      : await this.commerceAccessService.resolveSingleStoreId(
          user,
          dto.storeId,
          'sales:create',
          '无权操作该门店销售记录',
        );
    const orderDate = new Date(dto.date ?? Date.now());
    const operatorStaffId = await this.resolveOperatorStaffId(
      user,
      storeId,
      options,
      orderDate,
    );

    const preparedItems =
      await this.salesRecordItemPreparationService.prepareItems(
        storeId,
        dto,
        options,
      );

    // 使用统一金额聚合域计算权威金额（确保与 preview 计算一致）
    const amountsSnapshot =
      SalesRecordAmountsDomain.aggregateFromPreparedItems(preparedItems);
    // 空间结账场景：抵扣项在 items 中以正数存储，聚合会多算，
    // 使用结算层传入的权威值覆盖 totalRevenue / totalProfit。
    const totalRevenue =
      options.totalRevenueOverride ?? amountsSnapshot.totalRevenue;
    const totalProfit =
      options.totalProfitOverride ?? amountsSnapshot.totalProfit;
    const totalQuantity = amountsSnapshot.totalQuantity;

    const operatorNameSnapshot =
      await this.resolveOperatorNameSnapshot(operatorStaffId);

    const response = await this.salesRecordCreateFlowService.createRecord({
      storeId,
      operatorStaffId,
      operatorNameSnapshot,
      dto,
      preparedItems,
      totalRevenue,
      totalProfit,
      totalQuantity,
      note: toOptionalText(dto.note) ?? null,
      orderDate,
      options,
    });

    if (!options.transactionClient) {
      await this.invalidateStoreDerivedCaches(storeId);
    }

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

  private requireTrustedStoreId(storeId: number | undefined): number {
    if (storeId === undefined) {
      throw new NotFoundException('销售记录缺少门店信息');
    }

    return storeId;
  }

  private async resolveOperatorStaffId(
    user: AuthenticatedUser,
    storeId: number,
    _options: CreateSalesRecordOptions,
    _orderDate: Date,
  ): Promise<number | null> {
    const currentOperatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    // 系统用户（如自动结账调度）没有 membership，operatorStaffId 应为 null，
    // 使 SaleOrder.operatorNameSnapshot 也为 null，交班页兜底展示"空间自动结账"。
    // 交班页已不再按 operatorStaffId 过滤销售记录（按门店 + 时间范围查询），
    // 因此无需回退到班次员工。
    if (!user.currentMembership) {
      return null;
    }

    // 有 membership 的用户（主账号/店长/收银员）始终使用自身 staffId，
    // 确保本班销售记录中操作员显示为实际操作账号。
    return currentOperatorStaffId;
  }

  private async resolveOperatorNameSnapshot(
    operatorStaffId: number | null,
  ): Promise<string | null> {
    if (operatorStaffId === null) return null;
    const staff = await this.prisma.staff.findUnique({
      where: { id: operatorStaffId },
      select: { name: true },
    });
    return staff?.name ?? null;
  }
}
