import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type CostRecord } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toOptionalText } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { getPayrollCostDate, toCostDecimal } from './costs.domain';
import { buildCostRecordResponse } from './costs.mapper';
import type {
  PayrollComponentCostUpsertInput,
  PayrollCostUpsertInput,
  SyncPayrollCostInput,
  SyncPurchaseCostInput,
} from './costs.types';
import type { CreateCostRecordDto } from './dto/costs-query.dto';
import type { CostRecordResponseDto } from './dto/costs-response.dto';

@Injectable()
export class CostsWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async createRecord(
    user: AuthenticatedUser,
    dto: CreateCostRecordDto,
  ): Promise<CostRecordResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'cost:create',
      '无权新增成本记录',
    );
    const operatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('成本名称不能为空');
    }
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('成本金额必须大于 0');
    }

    const created = await this.prisma.costRecord.create({
      data: {
        storeId,
        operatorStaffId,
        sourceType: 'manual',
        title,
        type: dto.type,
        category: dto.category,
        amount: toCostDecimal(dto.amount),
        note: toOptionalText(dto.note) ?? null,
        date: new Date(dto.date),
      },
    });

    await this.invalidateDashboardCaches(storeId);

    return buildCostRecordResponse(created);
  }

  async deleteRecord(user: AuthenticatedUser, recordId: number): Promise<void> {
    const record = await this.prisma.costRecord.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        storeId: true,
        sourceType: true,
      },
    });

    if (!record) {
      throw new NotFoundException('成本记录不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      record.storeId,
      'cost:delete',
      '无权删除该成本记录',
    );

    if (record.sourceType !== 'manual') {
      throw new BadRequestException('自动沉淀的成本记录不支持手动删除');
    }

    await this.prisma.costRecord.delete({ where: { id: record.id } });
    await this.invalidateDashboardCaches(record.storeId);
  }

  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateProfitDashboardHome(storeId),
      this.cacheInvalidatorService.invalidatePulseDashboardOverview(storeId),
    ]);
  }

  async deletePurchaseCostRecord(
    transaction: Prisma.TransactionClient,
    storeId: number,
    purchaseOrderId: number,
  ): Promise<void> {
    await transaction.costRecord.deleteMany({
      where: {
        storeId,
        sourceType: 'purchase',
        purchaseOrderId,
      },
    });
  }

  async syncPurchaseCost(
    transaction: Prisma.TransactionClient,
    input: SyncPurchaseCostInput,
  ): Promise<CostRecord> {
    return transaction.costRecord.upsert({
      where: {
        storeId_sourceType_purchaseOrderId: {
          storeId: input.storeId,
          sourceType: 'purchase',
          purchaseOrderId: input.purchaseOrderId,
        },
      },
      create: {
        storeId: input.storeId,
        operatorStaffId: input.operatorStaffId,
        purchaseOrderId: input.purchaseOrderId,
        sourceType: 'purchase',
        title: input.title,
        type: 'variable',
        category: 'purchase',
        amount: toCostDecimal(input.amount),
        note: toOptionalText(input.note) ?? null,
        date: input.date,
      },
      update: {
        operatorStaffId: input.operatorStaffId,
        title: input.title,
        amount: toCostDecimal(input.amount),
        note: toOptionalText(input.note) ?? null,
        date: input.date,
      },
    });
  }

  async syncPayrollCosts(
    transaction: Prisma.TransactionClient,
    input: SyncPayrollCostInput,
  ): Promise<void> {
    if (!input.actualSalary || input.actualSalary <= 0) {
      await transaction.costRecord.deleteMany({
        where: {
          storeId: input.storeId,
          payrollId: input.payrollId,
          sourceType: 'payroll_salary',
        },
      });
    } else {
      await this.upsertPayrollCostRecord(transaction, {
        storeId: input.storeId,
        payrollId: input.payrollId,
        operatorStaffId: input.operatorStaffId,
        sourceType: 'payroll_salary',
        title: `${input.employeeName}${input.month}工资`,
        type: 'fixed',
        category: 'salary',
        amount: input.actualSalary,
        note: input.note,
        month: input.month,
      });
    }

    await this.upsertPayrollComponentCostRecord(transaction, {
      storeId: input.storeId,
      payrollId: input.payrollId,
      operatorStaffId: input.operatorStaffId,
      sourceType: 'payroll_insurance',
      title: `${input.employeeName}${input.month}社保`,
      category: 'insurance',
      amount: input.socialInsurance,
      month: input.month,
    });

    await this.upsertPayrollComponentCostRecord(transaction, {
      storeId: input.storeId,
      payrollId: input.payrollId,
      operatorStaffId: input.operatorStaffId,
      sourceType: 'payroll_provident_fund',
      title: `${input.employeeName}${input.month}公积金`,
      category: 'provident_fund',
      amount: input.housingFund,
      month: input.month,
    });
  }

  private async upsertPayrollComponentCostRecord(
    transaction: Prisma.TransactionClient,
    input: PayrollComponentCostUpsertInput,
  ): Promise<void> {
    if (input.amount === undefined || input.amount <= 0) {
      await transaction.costRecord.deleteMany({
        where: {
          storeId: input.storeId,
          payrollId: input.payrollId,
          sourceType: input.sourceType,
        },
      });
      return;
    }

    await this.upsertPayrollCostRecord(transaction, {
      storeId: input.storeId,
      payrollId: input.payrollId,
      operatorStaffId: input.operatorStaffId,
      sourceType: input.sourceType,
      title: input.title,
      type: 'fixed',
      category: input.category,
      amount: input.amount,
      month: input.month,
    });
  }

  private upsertPayrollCostRecord(
    transaction: Prisma.TransactionClient,
    input: PayrollCostUpsertInput,
  ): Promise<CostRecord> {
    return transaction.costRecord.upsert({
      where: {
        storeId_sourceType_payrollId: {
          storeId: input.storeId,
          sourceType: input.sourceType,
          payrollId: input.payrollId,
        },
      },
      create: {
        storeId: input.storeId,
        operatorStaffId: input.operatorStaffId,
        payrollId: input.payrollId,
        sourceType: input.sourceType,
        title: input.title,
        type: input.type,
        category: input.category,
        amount: toCostDecimal(input.amount),
        note: toOptionalText(input.note) ?? null,
        date: getPayrollCostDate(input.month),
      },
      update: {
        operatorStaffId: input.operatorStaffId,
        title: input.title,
        type: input.type,
        category: input.category,
        amount: toCostDecimal(input.amount),
        note: toOptionalText(input.note) ?? null,
        date: getPayrollCostDate(input.month),
      },
    });
  }
}
