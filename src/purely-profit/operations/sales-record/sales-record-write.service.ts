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
import { assertSalesTotalsMatch } from './sales-record.domain';
import { HandoverPageShiftRecordService } from '../handover/handover-page-shift-record.service';
import { SalesRecordCreateFlowService } from './sales-record-create-flow.service';
import {
  SalesRecordItemPreparationService,
  type CreateSalesRecordOptions,
} from './sales-record-item-preparation.service';
import { sumMoney } from './sales-record.utils';

@Injectable()
export class SalesRecordWriteService {
  private readonly logger = new Logger(SalesRecordWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly inventoryService: InventoryService,
    private readonly handoverPageShiftRecordService: HandoverPageShiftRecordService,
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
    options: CreateSalesRecordOptions,
    orderDate: Date,
  ): Promise<number | null> {
    const currentOperatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    // 系统用户（如自动结账调度）没有 membership，无法通过常规路径
    // 解析 operatorStaffId。为避免其创建的销售单在交班页面因
    // operatorStaffId 为 null 而被过滤掉，此处回退到当前班次员工。
    if (!user.currentMembership) {
      try {
        const pendingStaffId = await this.findPendingHandoverOperatorStaffId(
          storeId,
          orderDate,
        );
        if (pendingStaffId !== null) {
          return pendingStaffId;
        }

        return (
          (await this.findCurrentShiftOperatorStaffId(storeId, orderDate)) ??
          currentOperatorStaffId
        );
      } catch (error) {
        this.logger.warn(
          `resolveOperatorStaffId system-user fallback storeId=${storeId} orderDate=${orderDate.toISOString()} reason=${error instanceof Error ? error.name : 'UnknownError'}`,
        );
        return currentOperatorStaffId;
      }
    }

    if (!this.shouldAssignToCurrentShiftOperator(user, storeId, options)) {
      return currentOperatorStaffId;
    }

    try {
      const pendingHandoverOperatorStaffId =
        await this.findPendingHandoverOperatorStaffId(storeId, orderDate);
      if (pendingHandoverOperatorStaffId !== null) {
        return pendingHandoverOperatorStaffId;
      }

      return (
        (await this.findCurrentShiftOperatorStaffId(storeId, orderDate)) ??
        currentOperatorStaffId
      );
    } catch (error) {
      this.logger.warn(
        `resolveOperatorStaffId fallback storeId=${storeId} orderDate=${orderDate.toISOString()} reason=${error instanceof Error ? error.name : 'UnknownError'}`,
      );
      return currentOperatorStaffId;
    }
  }

  private async findPendingHandoverOperatorStaffId(
    storeId: number,
    referenceDate: Date,
  ): Promise<number | null> {
    const pendingShift =
      await this.handoverPageShiftRecordService.findStartedUnhandedShiftRecord(
        storeId,
        referenceDate,
      );
    if (!pendingShift?.employeeId) {
      return null;
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: pendingShift.employeeId },
      select: {
        linkedStaffId: true,
      },
    });

    return employee?.linkedStaffId ?? null;
  }

  private shouldAssignToCurrentShiftOperator(
    user: AuthenticatedUser,
    storeId: number,
    options: CreateSalesRecordOptions,
  ): boolean {
    const membership = user.currentMembership;
    if (
      !options.assignToCurrentShiftOperator ||
      !membership?.isActive ||
      membership.storeId !== storeId
    ) {
      return false;
    }

    return (
      membership.subjectType === 'owner' ||
      (membership.subjectType === 'sub_account' &&
        membership.subAccountRole === 'manager')
    );
  }

  private async findCurrentShiftOperatorStaffId(
    storeId: number,
    referenceDate: Date,
  ): Promise<number | null> {
    const currentShift =
      await this.handoverPageShiftRecordService.findCurrentShiftRecord(
        storeId,
        null,
        referenceDate,
      );
    if (!currentShift?.employeeId) {
      return null;
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: currentShift.employeeId },
      select: {
        linkedStaffId: true,
      },
    });

    return employee?.linkedStaffId ?? null;
  }
}
