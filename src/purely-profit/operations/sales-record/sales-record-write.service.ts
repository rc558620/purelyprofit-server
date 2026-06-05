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
import { HandoverPageShiftRecordService } from '../handover/handover-page-shift-record.service';
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
    const operatorStaffId = await this.resolveOperatorStaffId(
      user,
      storeId,
      options,
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

  private async resolveOperatorStaffId(
    user: AuthenticatedUser,
    storeId: number,
    options: CreateSalesRecordOptions,
  ): Promise<number | null> {
    const currentOperatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    if (!this.shouldAssignToCurrentShiftOperator(user, storeId, options)) {
      return currentOperatorStaffId;
    }

    const pendingHandoverOperatorStaffId =
      await this.findPendingHandoverOperatorStaffId(storeId);
    if (pendingHandoverOperatorStaffId !== null) {
      return pendingHandoverOperatorStaffId;
    }

    return (
      (await this.findCurrentShiftOperatorStaffId(storeId)) ??
      currentOperatorStaffId
    );
  }

  private async findPendingHandoverOperatorStaffId(
    storeId: number,
  ): Promise<number | null> {
    const pendingShift =
      await this.handoverPageShiftRecordService.findStartedUnhandedShiftRecord(
        storeId,
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
  ): Promise<number | null> {
    const shifts = await this.prisma.employeeShift.findMany({
      where: {
        storeId,
        date: this.buildCurrentDayRange(),
      },
      select: {
        startTime: true,
        endTime: true,
        employee: {
          select: {
            linkedStaffId: true,
          },
        },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const matchedShift = shifts.find((shift) =>
      this.isCurrentShift(shift.startTime, shift.endTime, currentMinutes),
    );

    return matchedShift?.employee.linkedStaffId ?? null;
  }

  private buildCurrentDayRange(): { gte: Date; lte: Date } {
    const now = new Date();
    const startAt = new Date(now);
    startAt.setHours(0, 0, 0, 0);
    const endAt = new Date(now);
    endAt.setHours(23, 59, 59, 999);
    return {
      gte: startAt,
      lte: endAt,
    };
  }

  private isCurrentShift(
    startTime: string,
    endTime: string,
    currentMinutes: number,
  ): boolean {
    const startMinutes = this.timeStringToMinutes(startTime);
    const endMinutes = this.timeStringToMinutes(endTime);
    if (startMinutes === null || endMinutes === null) {
      return false;
    }

    if (endMinutes <= startMinutes) {
      return (
        currentMinutes >= startMinutes || currentMinutes < endMinutes
      );
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  private timeStringToMinutes(timeText: string): number | null {
    const match = /^(\d{2}):(\d{2})$/.exec(timeText);
    if (!match) {
      return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (
      !Number.isInteger(hours) ||
      !Number.isInteger(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }

    return hours * 60 + minutes;
  }
}
