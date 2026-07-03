import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinanceReconciliationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import {
  buildFinanceReconciliationsListCacheKey,
  buildFinanceReconciliationsStatsCacheKey,
} from './finance.cache-keys';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import {
  ConfirmFinanceReconciliationDto,
  CreateFinanceReconciliationDto,
  ListFinanceReconciliationsQueryDto,
} from './dto/finance-reconciliation.query.dto';
import type {
  FinanceReconciliationRecordResponseDto,
  FinanceReconciliationStatsDto,
  PaginatedFinanceReconciliationsResponseDto,
} from './dto/finance-reconciliation.response.dto';
import {
  buildReconciliationItemCreateInput,
  buildReconciliationStats,
  deriveReconciliationAmountsAndStatus,
  mapReconciliationRecord,
} from './finance-reconciliation.domain';
import { FinanceAccessService } from './finance-access.service';
import {
  createReconciliationRecordEntity,
  deleteReconciliationRecordEntity,
  findReconciliationRecord,
  queryReconciliationRecordPage,
  queryReconciliationRecords,
  updateReconciliationConfirmation,
} from './finance-reconciliation.query';
import { buildPaginatedReconciliationsResponse } from './finance.mapper';
import type { FinanceReconciliationsListQueryInput } from './finance.types';
import { Money } from '../../shared/money.utils';
import { buildPaginationState } from './finance-pagination.utils';
import { trimOptionalString } from './finance-string.utils';

const FINANCE_RECONCILIATIONS_CACHE_TTL_SECONDS = 60;
const FINANCE_RECONCILIATIONS_REFRESH_AFTER_MS = 15_000;

@Injectable()
export class FinanceReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly financeAccessService: FinanceAccessService,
  ) {}

  async listReconciliations(
    user: AuthenticatedUser,
    query: ListFinanceReconciliationsQueryDto,
  ): Promise<PaginatedFinanceReconciliationsResponseDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const reconciliationQuery: FinanceReconciliationsListQueryInput = {
      statusFilter: query.statusFilter,
      typeFilter: query.typeFilter,
      searchText: query.searchText,
      page: query.page,
      pageSize: query.pageSize,
    };
    const cacheKey = buildFinanceReconciliationsListCacheKey(
      storeId,
      reconciliationQuery,
    );

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_RECONCILIATIONS_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_RECONCILIATIONS_REFRESH_AFTER_MS,
      loadValue: () =>
        this.buildReconciliationsList(storeId, reconciliationQuery),
      refreshValue: () =>
        this.buildReconciliationsList(storeId, reconciliationQuery),
    });
  }

  async getReconciliationStats(
    user: AuthenticatedUser,
  ): Promise<FinanceReconciliationStatsDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const cacheKey = buildFinanceReconciliationsStatsCacheKey(storeId);

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_RECONCILIATIONS_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_RECONCILIATIONS_REFRESH_AFTER_MS,
      loadValue: () => this.buildReconciliationStats(storeId),
      refreshValue: () => this.buildReconciliationStats(storeId),
    });
  }

  async createReconciliation(
    user: AuthenticatedUser,
    dto: CreateFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const operatorStaffId = user.currentMembership?.staffId ?? null;
    const bookIncome = Money.fromInputYuan(dto.bookIncome);
    const bookExpense = Money.fromInputYuan(dto.bookExpense);
    const actualIncome =
      dto.actualIncome != null ? Money.fromInputYuan(dto.actualIncome) : null;
    const actualExpense =
      dto.actualExpense != null ? Money.fromInputYuan(dto.actualExpense) : null;

    // 统一派生：后端是唯一真相源，前端不再传 status
    const { bookNet, actualNet, diffAmount, status } =
      deriveReconciliationAmountsAndStatus(
        bookIncome,
        bookExpense,
        actualIncome,
        actualExpense,
      );

    const items = (dto.items ?? []).map((item) =>
      buildReconciliationItemCreateInput(item),
    );

    const createdRecord = await createReconciliationRecordEntity(this.prisma, {
      storeId,
      operatorStaffId,
      title: dto.title.trim(),
      type: dto.type,
      status,
      channel: dto.type === 'payment' ? (dto.channel ?? 'all') : null,
      counterpart: trimOptionalString(dto.counterpart),
      periodStart: new Date(dto.periodStart),
      periodEnd: new Date(dto.periodEnd),
      bookIncome: bookIncome.toDbCents(),
      bookExpense: bookExpense.toDbCents(),
      bookNet: bookNet.toDbCents(),
      actualIncome: (actualIncome ?? Money.zero()).toDbCents(),
      actualExpense: (actualExpense ?? Money.zero()).toDbCents(),
      actualNet: actualNet.toDbCents(),
      diffAmount: diffAmount.toDbCents(),
      operator: trimOptionalString(dto.operator),
      note: trimOptionalString(dto.note),
      date: new Date(dto.date),
      items: {
        create: items,
      },
    });

    await this.cacheInvalidatorService.invalidateFinanceDerived(storeId);

    return mapReconciliationRecord(createdRecord);
  }

  async confirmReconciliation(
    user: AuthenticatedUser,
    recordId: number,
    dto: ConfirmFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const record = await findReconciliationRecord(this.prisma, {
      storeId,
      recordId,
    });
    if (!record) {
      throw new NotFoundException('对账单不存在');
    }

    if (
      record.status === FinanceReconciliationStatus.confirmed ||
      record.status === FinanceReconciliationStatus.adjusted
    ) {
      throw new ConflictException('已确认或已调整的对账单不能再次确认');
    }

    const adjustNote = trimOptionalString(dto.adjustNote);
    const updatedRecord = await updateReconciliationConfirmation(this.prisma, {
      recordId,
      status: adjustNote
        ? FinanceReconciliationStatus.adjusted
        : FinanceReconciliationStatus.confirmed,
      adjustNote,
    });

    await this.cacheInvalidatorService.invalidateFinanceDerived(storeId);

    return mapReconciliationRecord(updatedRecord);
  }

  async deleteReconciliation(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const record = await findReconciliationRecord(this.prisma, {
      storeId,
      recordId,
    });
    if (!record) {
      throw new NotFoundException('对账单不存在');
    }
    if (
      record.status === FinanceReconciliationStatus.confirmed ||
      record.status === FinanceReconciliationStatus.adjusted
    ) {
      throw new ConflictException('已确认或已调整的对账单不能删除');
    }
    await deleteReconciliationRecordEntity(this.prisma, recordId);
    await this.cacheInvalidatorService.invalidateFinanceDerived(storeId);
  }

  private async buildReconciliationsList(
    storeId: number,
    reconciliationQuery: FinanceReconciliationsListQueryInput,
  ): Promise<PaginatedFinanceReconciliationsResponseDto> {
    const pageState = buildPaginationState(
      reconciliationQuery.page,
      reconciliationQuery.pageSize,
    );
    const { items, total } = await queryReconciliationRecordPage(
      this.prisma,
      storeId,
      reconciliationQuery,
    );

    return buildPaginatedReconciliationsResponse(items, pageState, total);
  }

  private async buildReconciliationStats(
    storeId: number,
  ): Promise<FinanceReconciliationStatsDto> {
    const records = await queryReconciliationRecords(this.prisma, storeId);
    return buildReconciliationStats(records);
  }
}
