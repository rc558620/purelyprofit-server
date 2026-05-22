import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type CostCategory,
  type CostRecord,
  type CostSourceType,
  type CostType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  buildPreviousPurchaseDateRange,
  buildPurchaseDateRange,
  toDecimalNumber,
  toOptionalText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CostRecordStatsQueryDto,
  CostReportQueryDto,
  CreateCostRecordDto,
  ListCostRecordsQueryDto,
} from './dto/costs-query.dto';
import type {
  CostRecordResponseDto,
  CostReportCategoryRowDto,
  CostReportDetailRowDto,
  CostReportResponseDto,
  CostStatsResponseDto,
} from './dto/costs-response.dto';
import {
  COST_CATEGORY_META,
  type CostReportCategoryFilterValue,
  type CostReportPeriodValue,
} from './costs.types';

interface CostFilterRange {
  gte: Date;
  lte: Date;
}

interface CostQueryInput {
  period?: ListCostRecordsQueryDto['period'];
  typeFilter?: ListCostRecordsQueryDto['typeFilter'];
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
}

interface CostReportQueryInput {
  period?: CostReportPeriodValue;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
}

interface CostReportRange {
  start: number;
  end: number;
  period: CostReportPeriodValue;
}

interface CostReportCostRow {
  id: number;
  title: string;
  type: CostType;
  category: CostCategory;
  amount: Prisma.Decimal;
  note: string | null;
  date: Date;
  createdAt: Date;
}

interface CostReportPreviousRow {
  amount: Prisma.Decimal;
}

interface CostReportPayrollRow {
  id: number;
  employeeName: string;
  month: string;
  actualSalary: Prisma.Decimal;
  note: string | null;
}

interface SyncPurchaseCostInput {
  storeId: number;
  operatorStaffId: number | null;
  purchaseOrderId: number;
  amount: number;
  title: string;
  note?: string | null;
  date: Date;
}

interface SyncPayrollCostInput {
  storeId: number;
  payrollId: number;
  operatorStaffId: number | null;
  employeeName: string;
  month: string;
  actualSalary: number;
  socialInsurance?: number;
  housingFund?: number;
  note?: string | null;
}

@Injectable()
export class CostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async listRecords(
    user: AuthenticatedUser,
    query: ListCostRecordsQueryDto,
  ): Promise<CostRecordResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      undefined,
      'cost:view',
      '无权查看成本记录',
    );

    if (storeId === null) {
      return [];
    }

    const records = await this.prisma.costRecord.findMany({
      where: this.buildRecordWhere(storeId, query),
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });

    return records.map((record) => this.toCostRecordResponse(record));
  }

  async getStats(
    user: AuthenticatedUser,
    query: CostRecordStatsQueryDto,
  ): Promise<CostStatsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      undefined,
      'cost:view',
      '无权查看成本统计',
    );

    if (storeId === null) {
      return {
        total: 0,
        fixed: 0,
        variable: 0,
        compareLastPeriod: null,
        recordCount: 0,
      };
    }

    const currentWhere = this.buildRecordWhere(storeId, query);
    const currentRecords = await this.prisma.costRecord.findMany({
      where: currentWhere,
      select: {
        amount: true,
        type: true,
      },
    });

    const total = this.sumAmounts(currentRecords);
    const fixed = this.sumAmounts(
      currentRecords.filter((record) => record.type === 'fixed'),
    );
    const variable = this.sumAmounts(
      currentRecords.filter((record) => record.type === 'variable'),
    );
    const recordCount = currentRecords.length;

    let compareLastPeriod: number | null = null;
    if (this.shouldComparePrevious(query.period)) {
      const previousRange = this.buildPreviousRange(query);
      if (previousRange) {
        const previousRecords = await this.prisma.costRecord.findMany({
          where: {
            storeId,
            date: previousRange,
            ...(query.typeFilter && query.typeFilter !== 'all'
              ? { type: query.typeFilter }
              : {}),
          },
          select: { amount: true },
        });
        const previousTotal = this.sumAmounts(previousRecords);
        compareLastPeriod =
          previousTotal > 0
            ? Number(
                new Decimal(total)
                  .minus(previousTotal)
                  .div(previousTotal)
                  .mul(100)
                  .toFixed(2),
              )
            : null;
      }
    }

    return {
      total,
      fixed,
      variable,
      compareLastPeriod,
      recordCount,
    };
  }

  async getReport(
    user: AuthenticatedUser,
    query: CostReportQueryDto,
  ): Promise<CostReportResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店成本报表',
    );

    if (storeId === null) {
      return {
        summary: {
          total: 0,
          fixed: 0,
          variable: 0,
          recordCount: 0,
          compareLastPeriod: null,
        },
        categories: [],
        detailRows: [],
      };
    }

    const reportQuery: CostReportQueryInput = {
      period: query.period,
      year: query.year,
      customDate: query.customDate,
      rangeStartDate: query.rangeStartDate,
      rangeEndDate: query.rangeEndDate,
    };
    const currentRange = this.buildReportRange(reportQuery);
    const previousRange = this.buildPreviousReportRange(query.period, currentRange);
    const categoryFilter = query.categoryFilter ?? 'all';

    const [costRows, previousRows, payrollRows] = await Promise.all([
      this.prisma.costRecord.findMany({
        where: {
          storeId,
          date: {
            gte: new Date(currentRange.start),
            lte: new Date(currentRange.end),
          },
        },
        select: {
          id: true,
          title: true,
          type: true,
          category: true,
          amount: true,
          note: true,
          date: true,
          createdAt: true,
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      previousRange
        ? this.prisma.costRecord.findMany({
            where: {
              storeId,
              date: {
                gte: new Date(previousRange.start),
                lte: new Date(previousRange.end),
              },
            },
            select: {
              amount: true,
            },
          })
        : Promise.resolve([]),
      categoryFilter === 'salary'
        ? this.prisma.employeePayroll.findMany({
            where: {
              storeId,
              status: 'draft',
              month: {
                gte: this.toPayrollMonth(currentRange.start),
                lte: this.toPayrollMonth(currentRange.end),
              },
            },
            select: {
              id: true,
              employeeName: true,
              month: true,
              actualSalary: true,
              note: true,
            },
            orderBy: [{ month: 'desc' }, { id: 'desc' }],
          })
        : Promise.resolve([]),
    ]);

    const total = this.sumAmounts(costRows);
    const fixed = this.sumAmounts(
      costRows.filter((record) => record.type === 'fixed'),
    );
    const variable = Number(new Decimal(total).minus(fixed).toFixed(2));
    const previousTotal = this.sumAmounts(previousRows);

    return {
      summary: {
        total,
        fixed,
        variable,
        recordCount: costRows.length,
        compareLastPeriod:
          previousRange && previousTotal > 0
            ? Number(
                new Decimal(total)
                  .minus(previousTotal)
                  .div(previousTotal)
                  .mul(100)
                  .toFixed(2),
              )
            : null,
      },
      categories: this.buildCostReportCategories(costRows, total),
      detailRows: this.buildCostReportDetailRows(
        costRows,
        payrollRows,
        categoryFilter,
      ),
    };
  }

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
        amount: this.toDecimal(dto.amount),
        note: toOptionalText(dto.note) ?? null,
        date: new Date(dto.date),
      },
    });

    return this.toCostRecordResponse(created);
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
        amount: this.toDecimal(input.amount),
        note: toOptionalText(input.note) ?? null,
        date: input.date,
      },
      update: {
        operatorStaffId: input.operatorStaffId,
        title: input.title,
        amount: this.toDecimal(input.amount),
        note: toOptionalText(input.note) ?? null,
        date: input.date,
      },
    });
  }

  async syncPayrollCosts(
    transaction: Prisma.TransactionClient,
    input: SyncPayrollCostInput,
  ): Promise<void> {
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
    input: {
      storeId: number;
      payrollId: number;
      operatorStaffId: number | null;
      sourceType: Extract<
        CostSourceType,
        'payroll_insurance' | 'payroll_provident_fund'
      >;
      title: string;
      category: Extract<CostCategory, 'insurance' | 'provident_fund'>;
      amount?: number;
      month: string;
    },
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

  private async upsertPayrollCostRecord(
    transaction: Prisma.TransactionClient,
    input: {
      storeId: number;
      payrollId: number;
      operatorStaffId: number | null;
      sourceType: Extract<
        CostSourceType,
        'payroll_salary' | 'payroll_insurance' | 'payroll_provident_fund'
      >;
      title: string;
      type: CostType;
      category: CostCategory;
      amount: number;
      month: string;
      note?: string | null;
    },
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
        amount: this.toDecimal(input.amount),
        note: toOptionalText(input.note) ?? null,
        date: this.getPayrollCostDate(input.month),
      },
      update: {
        operatorStaffId: input.operatorStaffId,
        title: input.title,
        type: input.type,
        category: input.category,
        amount: this.toDecimal(input.amount),
        note: toOptionalText(input.note) ?? null,
        date: this.getPayrollCostDate(input.month),
      },
    });
  }

  private buildRecordWhere(
    storeId: number,
    query: CostQueryInput,
  ): Prisma.CostRecordWhereInput {
    const range = this.buildRange(query);
    return {
      storeId,
      ...(range ? { date: range } : {}),
      ...(query.typeFilter && query.typeFilter !== 'all'
        ? { type: query.typeFilter }
        : {}),
    };
  }

  private buildRange(query: CostQueryInput): CostFilterRange | undefined {
    return buildPurchaseDateRange(
      query.period,
      query.customDate,
      query.rangeStartDate,
      query.rangeEndDate,
    );
  }

  private buildPreviousRange(
    query: CostQueryInput,
  ): { gte: Date; lte: Date } | undefined {
    const currentRange = this.buildRange(query);
    return buildPreviousPurchaseDateRange(currentRange);
  }

  private shouldComparePrevious(period: CostQueryInput['period']): boolean {
    return (
      period === 'week' ||
      period === 'month' ||
      period === 'quarter' ||
      period === 'all'
    );
  }

  private buildReportRange(query: CostReportQueryInput): CostReportRange {
    const period = query.period ?? 'month';
    const now = Date.now();
    const current = new Date(now);

    switch (period) {
      case 'today':
        return {
          start: this.getDayStart(now),
          end: now,
          period,
        };
      case 'week': {
        const start = new Date(current);
        const day = start.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        start.setDate(start.getDate() + diff);
        start.setHours(0, 0, 0, 0);
        return {
          start: start.getTime(),
          end: now,
          period,
        };
      }
      case 'month':
        return {
          start: new Date(
            current.getFullYear(),
            current.getMonth(),
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: now,
          period,
        };
      case 'quarter': {
        const quarterStartMonth = Math.floor(current.getMonth() / 3) * 3;
        return {
          start: new Date(
            current.getFullYear(),
            quarterStartMonth,
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: now,
          period,
        };
      }
      case 'year': {
        const year = query.year ?? current.getFullYear();
        return {
          start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
          end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
          period,
        };
      }
      case 'custom_month': {
        if (query.customDate === undefined) {
          throw new BadRequestException('自定义单日模式需要传 customDate');
        }
        return {
          start: this.getDayStart(query.customDate),
          end: this.getDayEnd(query.customDate),
          period,
        };
      }
      case 'custom_range': {
        if (
          query.rangeStartDate === undefined ||
          query.rangeEndDate === undefined
        ) {
          throw new BadRequestException(
            '自定义区间模式需要同时传 rangeStartDate 和 rangeEndDate',
          );
        }
        const start = Math.min(query.rangeStartDate, query.rangeEndDate);
        const end = Math.max(query.rangeStartDate, query.rangeEndDate);
        return {
          start: this.getDayStart(start),
          end: this.getDayEnd(end),
          period,
        };
      }
    }
  }

  private buildPreviousReportRange(
    period: CostReportPeriodValue | undefined,
    currentRange: CostReportRange,
  ): CostReportRange | null {
    const resolvedPeriod = period ?? 'month';

    switch (resolvedPeriod) {
      case 'today':
      case 'custom_month':
        return {
          start: this.getDayStart(currentRange.start - 24 * 60 * 60 * 1000),
          end: currentRange.start - 1,
          period: resolvedPeriod,
        };
      case 'week':
        return {
          start: currentRange.start - 7 * 24 * 60 * 60 * 1000,
          end: currentRange.start - 1,
          period: resolvedPeriod,
        };
      case 'month': {
        const currentStart = new Date(currentRange.start);
        return {
          start: new Date(
            currentStart.getFullYear(),
            currentStart.getMonth() - 1,
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: currentRange.start - 1,
          period: resolvedPeriod,
        };
      }
      case 'quarter': {
        const currentStart = new Date(currentRange.start);
        return {
          start: new Date(
            currentStart.getFullYear(),
            currentStart.getMonth() - 3,
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: currentRange.start - 1,
          period: resolvedPeriod,
        };
      }
      case 'year': {
        const currentStart = new Date(currentRange.start);
        const year = currentStart.getFullYear() - 1;
        return {
          start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
          end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
          period: resolvedPeriod,
        };
      }
      case 'custom_range': {
        const duration = currentRange.end - currentRange.start;
        return {
          start: currentRange.start - duration - 1,
          end: currentRange.start - 1,
          period: resolvedPeriod,
        };
      }
    }
  }

  private buildCostReportCategories(
    rows: CostReportCostRow[],
    total: number,
  ): CostReportCategoryRowDto[] {
    if (total <= 0) {
      return [];
    }

    const totals = new Map<CostCategory, Decimal>();
    for (const row of rows) {
      totals.set(
        row.category,
        (totals.get(row.category) ?? new Decimal(0)).plus(row.amount.toString()),
      );
    }

    return Array.from(totals.entries())
      .map(([category, amount]) => ({
        label: COST_CATEGORY_META[category].label,
        amount: Number(amount.toFixed(2)),
        percentage: Number(
          amount.div(total).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
        ),
        color: COST_CATEGORY_META[category].color,
      }))
      .sort((left, right) => right.amount - left.amount);
  }

  private buildCostReportDetailRows(
    costRows: CostReportCostRow[],
    payrollRows: CostReportPayrollRow[],
    categoryFilter: CostReportCategoryFilterValue,
  ): CostReportDetailRowDto[] {
    if (categoryFilter === 'all') {
      return [];
    }

    const rows: CostReportDetailRowDto[] = costRows
      .filter((row) => row.category === categoryFilter)
      .map((row) => ({
        id: String(row.id),
        title: row.title,
        amount: toDecimalNumber(row.amount),
        date: toTimestampMs(row.date),
        dateLabel: this.formatCostReportDate(row.date),
        ...(row.note ? { note: row.note } : {}),
      }));

    if (categoryFilter === 'salary') {
      rows.push(
        ...payrollRows.map((row) => ({
          id: String(row.id),
          title: `[草稿] ${row.employeeName} ${row.month} 工资`,
          amount: toDecimalNumber(row.actualSalary),
          date: this.getPayrollCostDate(row.month).getTime(),
          dateLabel: row.month,
          ...(row.note ? { note: row.note } : {}),
        })),
      );
    }

    return rows.sort((left, right) => right.date - left.date);
  }

  private toPayrollMonth(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private formatCostReportDate(date: Date): string {
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
      date.getDate(),
    ).padStart(2, '0')}`;
  }

  private getDayStart(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  private getDayEnd(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }

  private toCostRecordResponse(record: {
    id: number;
    title: string;
    type: CostType;
    category: CostCategory;
    sourceType: CostSourceType;
    amount: Prisma.Decimal;
    note: string | null;
    date: Date;
    createdAt: Date;
  }): CostRecordResponseDto {
    return {
      id: String(record.id),
      title: record.title,
      type: record.type,
      category: record.category,
      amount: toDecimalNumber(record.amount),
      date: toTimestampMs(record.date),
      ...(record.note ? { note: record.note } : {}),
      sourceType: record.sourceType,
      deletable: record.sourceType === 'manual',
      createdAt: toTimestampMs(record.createdAt),
    };
  }

  private sumAmounts(records: Array<{ amount: Prisma.Decimal }>): number {
    return Number(
      records
        .reduce(
          (total, record) => total.plus(record.amount.toString()),
          new Decimal(0),
        )
        .toFixed(2),
    );
  }

  private getPayrollCostDate(month: string): Date {
    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthValue = Number(monthText);
    return new Date(year, monthValue - 1, 1, 0, 0, 0, 0);
  }

  private toDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(new Decimal(value).toFixed(2));
  }
}
