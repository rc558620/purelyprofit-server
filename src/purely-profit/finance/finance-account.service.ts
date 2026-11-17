import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService, TX_TIMEOUT_SHORT } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import {
  buildFinanceAccountsListCacheKey,
  buildFinanceAccountsStatsCacheKey,
} from './finance.cache-keys';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import {
  CreateFinanceAccountDto,
  ListFinanceAccountsQueryDto,
  SettleFinanceAccountDto,
} from './dto/finance-account.query.dto';
import type {
  FinanceAccountRecordResponseDto,
  FinanceAccountsStatsDto,
  PaginatedFinanceAccountsResponseDto,
} from './dto/finance-account.response.dto';
import {
  assertAccountCategoryCanCreateManually,
  assertAccountTypeMatchesCategory,
  buildAccountsStatsFromAggregate,
  deriveAccountFields,
  mapAccountRecord,
} from './finance-account.domain';
import { queryAccountStatsAggregate } from './finance-account-stats.query';
import { FinanceAccessService } from './finance-access.service';
import {
  createAccountRecordEntity,
  deleteOpenAccountRecordEntity,
  findAccountRecord,
  updateAccountRecordSettlement,
} from './finance-account.query';
import { queryAccountRecords } from './finance-account.list.query';
import { buildPaginatedAccountsResponse } from './finance.mapper';
import {
  encodeFinanceAccountCursor,
  resolveFinanceAccountPaging,
} from './finance-account.cursor';
import type { FinanceAccountListPaging } from './finance-account.cursor';
import type {
  FinanceAccountRecordWithAmount,
  FinanceAccountsListQueryInput,
} from './finance.types';
import { Money } from '../../shared/money.utils';
import { buildPaginationState } from './finance-pagination.utils';
import { trimOptionalString } from './finance-string.utils';
import {
  FINANCE_LIST_CACHE_TTL_SECONDS,
  FINANCE_LIST_REFRESH_AFTER_MS,
} from './finance.constants';

@Injectable()
export class FinanceAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly financeAccessService: FinanceAccessService,
  ) {}

  async listAccounts(
    user: AuthenticatedUser,
    query: ListFinanceAccountsQueryDto,
  ): Promise<PaginatedFinanceAccountsResponseDto> {
    const { storeId } = await this.financeAccessService.getFinanceContext(user);
    const accountQuery: FinanceAccountsListQueryInput = {
      typeFilter: query.typeFilter,
      statusFilter: query.statusFilter,
      searchText: query.searchText,
      datePeriod: query.datePeriod,
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
    const paging = resolveFinanceAccountPaging(query);

    /**
     * 游标页不进缓存：cursor 天生一次性，按 cursor 拼 key 会让缓存无界增长，
     * 且无法被 buildFinanceAccountsPattern 的统一失效覆盖。
     * offset / 首页路径的缓存 key 与 TTL 完全不变（key 里只有 page/pageSize）。
     */
    if (paging.cursor) {
      return this.buildAccountsList(storeId, accountQuery, paging);
    }

    const cacheKey = buildFinanceAccountsListCacheKey(storeId, accountQuery);

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_LIST_REFRESH_AFTER_MS,
      loadValue: () => this.buildAccountsList(storeId, accountQuery, paging),
      refreshValue: () => this.buildAccountsList(storeId, accountQuery, paging),
    });
  }

  async getAccountsStats(
    user: AuthenticatedUser,
  ): Promise<FinanceAccountsStatsDto> {
    const { storeId } = await this.financeAccessService.getFinanceContext(user);
    const cacheKey = buildFinanceAccountsStatsCacheKey(storeId);

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_LIST_REFRESH_AFTER_MS,
      loadValue: () => this.loadAccountsStats(storeId),
      refreshValue: () => this.loadAccountsStats(storeId),
    });
  }

  async createAccount(
    user: AuthenticatedUser,
    dto: CreateFinanceAccountDto,
  ): Promise<FinanceAccountRecordResponseDto> {
    const { storeId } = await this.financeAccessService.getFinanceContext(user);
    const operatorStaffId = user.currentMembership?.staffId ?? null;
    const amount = Money.fromInputYuan(dto.amount);
    const paidAmount = Money.fromInputYuan(dto.paidAmount);

    assertAccountCategoryCanCreateManually(dto.category);
    assertAccountTypeMatchesCategory(dto.type, dto.category);

    if (paidAmount.greaterThan(amount)) {
      throw new ConflictException('已收付金额不能大于总金额');
    }
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    const derived = deriveAccountFields(amount, paidAmount, dto.dueDate);
    const createdRecord = await createAccountRecordEntity(this.prisma, {
      storeId,
      operatorStaffId,
      type: dto.type,
      category: dto.category,
      counterpart: dto.counterpart.trim(),
      amount: amount.toDbCents(),
      paidAmount: paidAmount.toDbCents(),
      remaining: derived.remaining,
      status: derived.status,
      dueDate,
      date: new Date(dto.date),
      note: trimOptionalString(dto.note),
    });

    await this.invalidateDashboardCaches(storeId);

    return mapAccountRecord(createdRecord);
  }

  async settleAccount(
    user: AuthenticatedUser,
    recordId: number,
    dto: SettleFinanceAccountDto,
  ): Promise<FinanceAccountRecordResponseDto> {
    const { storeId } = await this.financeAccessService.getFinanceContext(user);
    const updatedRecord = await this.prisma.$transaction(
      async (tx) => {
        const record = await findAccountRecord(tx, { storeId, recordId });
        if (!record) {
          throw new NotFoundException('账款记录不存在');
        }

        const currentPaidAmount = Money.fromDbCents(record.paidAmount);
        const amount = Money.fromDbCents(record.amount);
        const payAmount = Money.fromInputYuan(dto.payAmount);
        const nextPaidAmount = currentPaidAmount.add(payAmount);
        if (nextPaidAmount.greaterThan(amount)) {
          throw new ConflictException('本次收付金额超过剩余金额');
        }
        const derived = deriveAccountFields(
          amount,
          nextPaidAmount,
          record.dueDate?.getTime() ?? undefined,
        );
        const settledRecord = await updateAccountRecordSettlement(tx, {
          storeId,
          recordId,
          expectedPaidAmount: record.paidAmount,
          paidAmount: nextPaidAmount.toDbCents(),
          remaining: derived.remaining,
          status: derived.status,
        });
        if (!settledRecord) {
          throw new ConflictException('账款记录已被其他操作更新，请刷新后重试');
        }
        return settledRecord;
      },
      { timeout: TX_TIMEOUT_SHORT },
    );

    await this.invalidateDashboardCaches(storeId);

    return mapAccountRecord(updatedRecord);
  }

  async deleteAccount(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    const { storeId } = await this.financeAccessService.getFinanceContext(user);

    // 条件删除：未结清才允许删。命中 0 行时再查一次，只为区分 404 与 409
    const deleted = await deleteOpenAccountRecordEntity(this.prisma, {
      storeId,
      recordId,
    });
    if (!deleted) {
      const record = await findAccountRecord(this.prisma, {
        storeId,
        recordId,
      });
      if (!record) {
        throw new NotFoundException('账款记录不存在');
      }
      throw new ConflictException('已结清的账款不能删除');
    }

    await this.invalidateDashboardCaches(storeId);
  }

  private async buildAccountsList(
    storeId: number,
    accountQuery: FinanceAccountsListQueryInput,
    paging: FinanceAccountListPaging,
  ): Promise<PaginatedFinanceAccountsResponseDto> {
    const { items, total } = await queryAccountRecords(
      this.prisma,
      storeId,
      accountQuery,
      paging,
    );
    const pageState = buildPaginationState(paging.page, paging.limit);
    // 游标路径多取了一行用于探测下一页，只切给游标判定用，响应里去掉
    const pageCursor = buildAccountPageCursor(items, total, paging);

    return buildPaginatedAccountsResponse(
      paging.cursor ? items.slice(0, paging.limit) : items,
      pageState,
      total,
      pageCursor,
    );
  }

  private async loadAccountsStats(
    storeId: number,
  ): Promise<FinanceAccountsStatsDto> {
    const aggregate = await queryAccountStatsAggregate(this.prisma, {
      storeId,
      now: Date.now(),
    });
    return buildAccountsStatsFromAggregate(aggregate);
  }

  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateDashboardAndPulseSession(storeId),
      this.cacheInvalidatorService.invalidateFinanceDerived(storeId),
    ]);
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
function buildAccountPageCursor(
  items: FinanceAccountRecordWithAmount[],
  total: number,
  paging: FinanceAccountListPaging,
): { hasMore: boolean; nextCursor: string | null } {
  const hasMore = paging.cursor
    ? items.length > paging.limit
    : paging.offset + items.length < total;
  const lastItem = items.at(Math.min(items.length, paging.limit) - 1);
  return {
    hasMore,
    nextCursor:
      hasMore && lastItem ? encodeFinanceAccountCursor(lastItem) : null,
  };
}
