import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import {
  buildFinanceCashFlowListCacheKey,
  buildFinanceCashFlowStatsCacheKey,
} from './finance.cache-keys';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import {
  CreateFinanceCashFlowRecordDto,
  ListFinanceCashFlowRecordsQueryDto,
} from './dto/finance-cash-flow.query.dto';
import type {
  FinanceCashFlowRecordResponseDto,
  FinanceCashFlowStatsDto,
  PaginatedFinanceCashFlowRecordsResponseDto,
} from './dto/finance-cash-flow.response.dto';
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
import {
  encodeFinanceCashFlowCursor,
  resolveFinanceCashFlowPaging,
} from './finance-cash-flow.cursor';
import type { FinanceCashFlowListPaging } from './finance-cash-flow.cursor';
import { buildPaginatedCashFlowRecordsResponse } from './finance.mapper';
import type {
  FinanceCashFlowListQueryInput,
  FinanceCashFlowRecordWithAmount,
} from './finance.types';
import { Money, calcPercentChangeWithFallback } from '../../shared/money.utils';
import { buildPaginationState } from './finance-pagination.utils';
import {
  getCashFlowFilterRange,
  getPreviousCashFlowRange,
} from './finance-range-cashflow.utils';
import { trimOptionalString } from './finance-string.utils';

const FINANCE_CASH_FLOW_CACHE_TTL_SECONDS = 60;
const FINANCE_CASH_FLOW_REFRESH_AFTER_MS = 15_000;

@Injectable()
export class FinanceCashFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
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
    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    const scope = callerIsSubAccount ? 'sub_account' : 'owner';
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
    // 入参校验先于缓存与取数：cursor 非法时直接 400，不白跑一次查询
    const paging = resolveFinanceCashFlowPaging(query);

    /**
     * 游标页不进缓存：cursor 天生一次性，按 cursor 拼 key 会让缓存无界增长，
     * 且无法被 buildFinanceCashFlowPattern 的统一失效覆盖。
     * offset / 首页路径的缓存 key 与 TTL 完全不变（key 里只有 page/pageSize）。
     */
    if (paging.cursor) {
      return this.buildCashFlowRecords(
        storeId,
        cashFlowQuery,
        callerIsSubAccount,
        paging,
      );
    }

    const cacheKey = buildFinanceCashFlowListCacheKey(storeId, {
      ...cashFlowQuery,
      scope,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_CASH_FLOW_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_CASH_FLOW_REFRESH_AFTER_MS,
      loadValue: () =>
        this.buildCashFlowRecords(
          storeId,
          cashFlowQuery,
          callerIsSubAccount,
          paging,
        ),
      refreshValue: () =>
        this.buildCashFlowRecords(
          storeId,
          cashFlowQuery,
          callerIsSubAccount,
          paging,
        ),
    });
  }

  async getCashFlowStats(
    user: AuthenticatedUser,
    query: ListFinanceCashFlowRecordsQueryDto,
  ): Promise<FinanceCashFlowStatsDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    const scope = callerIsSubAccount ? 'sub_account' : 'owner';
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
    const cacheKey = buildFinanceCashFlowStatsCacheKey(storeId, {
      ...cashFlowQuery,
      scope,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_CASH_FLOW_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_CASH_FLOW_REFRESH_AFTER_MS,
      loadValue: () =>
        this.buildCashFlowStats(storeId, cashFlowQuery, callerIsSubAccount),
      refreshValue: () =>
        this.buildCashFlowStats(storeId, cashFlowQuery, callerIsSubAccount),
    });
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
      amount: Money.fromInputYuan(dto.amount).toDbCents(),
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

    await deleteCashFlowRecordEntity(this.prisma, storeId, recordId);
    await this.invalidateDerivedCaches(storeId);
  }

  private async buildCashFlowRecords(
    storeId: number,
    cashFlowQuery: FinanceCashFlowListQueryInput,
    callerIsSubAccount: boolean,
    paging: FinanceCashFlowListPaging,
  ): Promise<PaginatedFinanceCashFlowRecordsResponseDto> {
    const range = getCashFlowFilterRange(cashFlowQuery);
    const clampedRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        range,
        callerIsSubAccount,
      );
    const directionFilter = cashFlowQuery.directionFilter ?? 'all';
    const pageState = buildPaginationState(paging.page, paging.limit);

    if (clampedRange.empty) {
      return buildPaginatedCashFlowRecordsResponse([], pageState, 0, {
        hasMore: false,
        nextCursor: null,
      });
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
      skip: paging.offset,
      // 游标路径多取一行做「是否还有下一页」探测，省掉一次额外查询
      take: paging.cursor ? paging.limit + 1 : paging.limit,
      cursor: paging.cursor,
    });

    return buildPaginatedCashFlowRecordsResponse(
      paging.cursor ? records.slice(0, paging.limit) : records,
      pageState,
      total,
      buildCashFlowPageCursor(records, total, paging),
    );
  }

  private async buildCashFlowStats(
    storeId: number,
    cashFlowQuery: FinanceCashFlowListQueryInput,
    callerIsSubAccount: boolean,
  ): Promise<FinanceCashFlowStatsDto> {
    const range = getCashFlowFilterRange(cashFlowQuery);
    const clampedRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        range,
        callerIsSubAccount,
      );

    if (clampedRange.empty) {
      return {
        totalIncome: 0,
        totalExpense: 0,
        netFlow: 0,
        recordCount: 0,
        compareLastPeriod: null,
      };
    }

    // 统计口径恒为全量收支，不跟随列表的 directionFilter（有意设计）：
    // 统计卡需同时展示收入与支出，若跟随筛选则另一侧恒为 0。
    const currentRecords = await queryCashFlowStatsRows(this.prisma, {
      storeId,
      range: clampedRange,
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
        callerIsSubAccount,
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
      compareLastPeriod:
        previousStats.netFlow === 0
          ? null
          : calcPercentChangeWithFallback(
              baseStats.netFlow,
              previousStats.netFlow,
              { absoluteBase: true },
            ),
    };
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

/**
 * 到底判定 + nextCursor 组装（两条路径共用）。
 *
 * - 游标路径：`take = limit + 1` 的探测行存在即说明还有下一页；游标取自本页最后一行。
 * - offset 路径：没有探测行，只能用 `offset + 已取条数 < total` 推导。
 *
 * 恒等式 `hasMore === (nextCursor !== null)` 由本函数单点保证，
 * 调用方不要再各自拼装，否则两条路径迟早漂移。
 */
function buildCashFlowPageCursor(
  records: FinanceCashFlowRecordWithAmount[],
  total: number,
  paging: FinanceCashFlowListPaging,
): { hasMore: boolean; nextCursor: string | null } {
  const hasMore = paging.cursor
    ? records.length > paging.limit
    : paging.offset + records.length < total;
  const lastRecord = records.at(Math.min(records.length, paging.limit) - 1);
  return {
    hasMore,
    nextCursor:
      hasMore && lastRecord ? encodeFinanceCashFlowCursor(lastRecord) : null,
  };
}
