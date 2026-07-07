import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinanceAccountStatus } from '@prisma/client';
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
  buildAccountsStats,
  deriveAccountFields,
  mapAccountRecord,
} from './finance-account.domain';
import { FinanceAccessService } from './finance-access.service';
import {
  createAccountRecordEntity,
  deleteAccountRecordEntity,
  findAccountRecord,
  queryAccountRecords,
  queryAccountStatsRows,
  updateAccountRecordSettlement,
} from './finance-account.query';
import { buildPaginatedAccountsResponse } from './finance.mapper';
import type { FinanceAccountsListQueryInput } from './finance.types';
import { Money } from '../../shared/money.utils';
import { buildPaginationState } from './finance-pagination.utils';
import { trimOptionalString } from './finance-string.utils';

const FINANCE_ACCOUNTS_CACHE_TTL_SECONDS = 60;
const FINANCE_ACCOUNTS_REFRESH_AFTER_MS = 15_000;

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
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
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
    const cacheKey = buildFinanceAccountsListCacheKey(storeId, accountQuery);

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_ACCOUNTS_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_ACCOUNTS_REFRESH_AFTER_MS,
      loadValue: () => this.buildAccountsList(storeId, accountQuery),
      refreshValue: () => this.buildAccountsList(storeId, accountQuery),
    });
  }

  async getAccountsStats(
    user: AuthenticatedUser,
  ): Promise<FinanceAccountsStatsDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const cacheKey = buildFinanceAccountsStatsCacheKey(storeId);

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_ACCOUNTS_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_ACCOUNTS_REFRESH_AFTER_MS,
      loadValue: () => this.buildAccountsStats(storeId),
      refreshValue: () => this.buildAccountsStats(storeId),
    });
  }

  async createAccount(
    user: AuthenticatedUser,
    dto: CreateFinanceAccountDto,
  ): Promise<FinanceAccountRecordResponseDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
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
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
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
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const record = await findAccountRecord(this.prisma, {
      storeId,
      recordId,
    });
    if (!record) {
      throw new NotFoundException('账款记录不存在');
    }
    const derived = deriveAccountFields(
      Money.fromDbCents(record.amount),
      Money.fromDbCents(record.paidAmount),
      record.dueDate?.getTime() ?? undefined,
    );
    if (derived.status === FinanceAccountStatus.settled) {
      throw new ConflictException('已结清的账款不能删除');
    }
    await deleteAccountRecordEntity(this.prisma, storeId, recordId);
    await this.invalidateDashboardCaches(storeId);
  }

  private async buildAccountsList(
    storeId: number,
    accountQuery: FinanceAccountsListQueryInput,
  ): Promise<PaginatedFinanceAccountsResponseDto> {
    const { items, total } = await queryAccountRecords(
      this.prisma,
      storeId,
      accountQuery,
    );
    const pageState = buildPaginationState(
      accountQuery.page,
      accountQuery.pageSize,
    );

    return buildPaginatedAccountsResponse(items, pageState, total);
  }

  private async buildAccountsStats(
    storeId: number,
  ): Promise<FinanceAccountsStatsDto> {
    const records = await queryAccountStatsRows(this.prisma, storeId);
    return buildAccountsStats(records);
  }

  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateDashboardAndPulseSession(storeId),
      this.cacheInvalidatorService.invalidateFinanceDerived(storeId),
    ]);
  }
}
