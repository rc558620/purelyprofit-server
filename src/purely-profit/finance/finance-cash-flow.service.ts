import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import {
  CreateFinanceCashFlowRecordDto,
  ListFinanceCashFlowRecordsQueryDto,
} from './dto/finance-query.dto';
import type {
  FinanceCashFlowRecordResponseDto,
  FinanceCashFlowStatsDto,
  PaginatedFinanceCashFlowRecordsResponseDto,
} from './dto/finance-response.dto';
import {
  assertCashFlowCategoryCanCreateManually,
  assertCashFlowDirectionMatchesCategory,
  buildCashFlowBaseStats,
  mapCashFlowRecord,
} from './finance-cash-flow.domain';
import { FinanceAccessService } from './finance-access.service';
import {
  createCashFlowRecordEntity,
  deleteCashFlowRecordEntity,
  findCashFlowRecordOwnership,
  queryCashFlowRecordPage,
  queryCashFlowStatsRows,
} from './finance-cash-flow.query';
import { buildPaginatedCashFlowRecordsResponse } from './finance.mapper';
import type { FinanceCashFlowListQueryInput } from './finance.types';
import {
  buildPaginationState,
  getCashFlowFilterRange,
  getPreviousCashFlowRange,
  isZeroValue,
  roundMoneyValue,
  trimOptionalString,
  toPrismaDecimal,
} from './finance.utils';

@Injectable()
export class FinanceCashFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly financeAccessService: FinanceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async listCashFlowRecords(
    user: AuthenticatedUser,
    query: ListFinanceCashFlowRecordsQueryDto,
  ): Promise<PaginatedFinanceCashFlowRecordsResponseDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const cashFlowQuery: FinanceCashFlowListQueryInput = {
      period: query.period,
      directionFilter: query.directionFilter,
      customDayYear: query.customDayYear,
      customDayMonth: query.customDayMonth,
      customDayDay: query.customDayDay,
      customRangeStartYear: query.customRangeStartYear,
      customRangeStartMonth: query.customRangeStartMonth,
      customRangeStartDay: query.customRangeStartDay,
      customRangeEndYear: query.customRangeEndYear,
      customRangeEndMonth: query.customRangeEndMonth,
      customRangeEndDay: query.customRangeEndDay,
      page: query.page,
      pageSize: query.pageSize,
    };
    const range = getCashFlowFilterRange(cashFlowQuery);
    const clampedRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        range,
      );
    const directionFilter = cashFlowQuery.directionFilter ?? 'all';
    const pageState = buildPaginationState(
      cashFlowQuery.page,
      cashFlowQuery.pageSize,
    );

    if (clampedRange.empty) {
      return buildPaginatedCashFlowRecordsResponse([], pageState, 0);
    }

    const where: Prisma.FinanceCashFlowRecordWhereInput = {
      storeId,
      date: {
        gte: new Date(clampedRange.start),
        lte: new Date(clampedRange.end),
      },
      ...(directionFilter !== 'all' ? { direction: directionFilter } : {}),
    };

    const { total, records } = await queryCashFlowRecordPage(this.prisma, {
      where,
      page: pageState.page,
      pageSize: pageState.pageSize,
    });

    return buildPaginatedCashFlowRecordsResponse(records, pageState, total);
  }

  async getCashFlowStats(
    user: AuthenticatedUser,
    query: ListFinanceCashFlowRecordsQueryDto,
  ): Promise<FinanceCashFlowStatsDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const cashFlowQuery: FinanceCashFlowListQueryInput = {
      period: query.period,
      directionFilter: query.directionFilter,
      customDayYear: query.customDayYear,
      customDayMonth: query.customDayMonth,
      customDayDay: query.customDayDay,
      customRangeStartYear: query.customRangeStartYear,
      customRangeStartMonth: query.customRangeStartMonth,
      customRangeStartDay: query.customRangeStartDay,
      customRangeEndYear: query.customRangeEndYear,
      customRangeEndMonth: query.customRangeEndMonth,
      customRangeEndDay: query.customRangeEndDay,
    };
    const range = getCashFlowFilterRange(cashFlowQuery);
    const clampedRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        range,
      );
    const directionFilter = cashFlowQuery.directionFilter ?? 'all';

    if (clampedRange.empty) {
      return {
        totalIncome: 0,
        totalExpense: 0,
        netFlow: 0,
        recordCount: 0,
        compareLastPeriod: null,
      };
    }

    const currentRecords = await queryCashFlowStatsRows(this.prisma, {
      storeId,
      range: clampedRange,
      directionFilter: directionFilter === 'all' ? undefined : directionFilter,
    });
    const baseStats = buildCashFlowBaseStats(currentRecords);
    const previousRange = getPreviousCashFlowRange(range.period);
    if (previousRange === null) {
      return {
        ...baseStats,
        compareLastPeriod: null,
      };
    }

    const clampedPreviousRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        previousRange,
      );
    if (clampedPreviousRange.empty) {
      return {
        ...baseStats,
        compareLastPeriod: null,
      };
    }

    const previousRecords = await queryCashFlowStatsRows(this.prisma, {
      storeId,
      range: clampedPreviousRange,
    });
    const previousStats = buildCashFlowBaseStats(previousRecords);

    return {
      ...baseStats,
      compareLastPeriod: isZeroValue(previousStats.netFlow)
        ? null
        : roundMoneyValue(
            ((baseStats.netFlow - previousStats.netFlow) /
              Math.abs(previousStats.netFlow)) *
              100,
          ),
    };
  }

  async createCashFlowRecord(
    user: AuthenticatedUser,
    dto: CreateFinanceCashFlowRecordDto,
  ): Promise<FinanceCashFlowRecordResponseDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const operatorStaffId = user.currentMembership?.staffId ?? null;

    assertCashFlowCategoryCanCreateManually(dto.category);
    assertCashFlowDirectionMatchesCategory(dto.direction, dto.category);

    const createdRecord = await createCashFlowRecordEntity(this.prisma, {
      storeId,
      operatorStaffId,
      direction: dto.direction,
      category: dto.category,
      title: dto.title.trim(),
      amount: toPrismaDecimal(dto.amount),
      payment: dto.payment,
      note: trimOptionalString(dto.note),
      date: new Date(dto.date),
    });

    await this.invalidateDerivedCaches(storeId);

    return mapCashFlowRecord(createdRecord);
  }

  async deleteCashFlowRecord(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const record = await this.ensureCashFlowRecordExists(storeId, recordId);

    if (record.saleOrderId !== null) {
      throw new ConflictException('销售收入流水需通过删除销售记录回滚');
    }

    await deleteCashFlowRecordEntity(this.prisma, recordId);
    await this.invalidateDerivedCaches(storeId);
  }

  private async invalidateDerivedCaches(storeId: number): Promise<void> {
    await this.cacheInvalidatorService.invalidateFinanceDerived(storeId);
  }

  private async ensureCashFlowRecordExists(
    storeId: number,
    recordId: number,
  ): Promise<{ id: number; saleOrderId: number | null }> {
    const record = await findCashFlowRecordOwnership(this.prisma, {
      storeId,
      recordId,
    });
    if (!record) {
      throw new NotFoundException('现金流水记录不存在');
    }
    return record;
  }
}
