import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinanceReconciliationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService, TX_TIMEOUT_SHORT } from '../../prisma/prisma.service';
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
  deleteUnconfirmedReconciliationRecordEntity,
  findReconciliationRecord,
  queryReconciliationRecordPage,
  queryReconciliationStatsRows,
  updateReconciliationConfirmation,
} from './finance-reconciliation.query';
import { buildPaginatedReconciliationsResponse } from './finance.mapper';
import type { FinanceReconciliationsListQueryInput } from './finance.types';
import { Money } from '../../shared/money.utils';
import { buildPaginationState } from './finance-pagination.utils';
import { trimOptionalString } from './finance-string.utils';
import {
  FINANCE_LIST_CACHE_TTL_SECONDS,
  FINANCE_LIST_REFRESH_AFTER_MS,
} from './finance.constants';

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
    const { storeId } = await this.financeAccessService.getFinanceContext(user);
    const reconciliationQuery: FinanceReconciliationsListQueryInput = {
      statusFilter: query.statusFilter,
      typeFilter: query.typeFilter,
      searchText: query.searchText?.trim() || undefined,
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
      ttlSeconds: FINANCE_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_LIST_REFRESH_AFTER_MS,
      loadValue: () =>
        this.buildReconciliationsList(storeId, reconciliationQuery),
      refreshValue: () =>
        this.buildReconciliationsList(storeId, reconciliationQuery),
    });
  }

  async getReconciliationStats(
    user: AuthenticatedUser,
  ): Promise<FinanceReconciliationStatsDto> {
    const { storeId } = await this.financeAccessService.getFinanceContext(user);
    const cacheKey = buildFinanceReconciliationsStatsCacheKey(storeId);

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_LIST_REFRESH_AFTER_MS,
      loadValue: () => this.loadReconciliationStats(storeId),
      refreshValue: () => this.loadReconciliationStats(storeId),
    });
  }

  async createReconciliation(
    user: AuthenticatedUser,
    dto: CreateFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    const { storeId } = await this.financeAccessService.getFinanceContext(user);

    if (dto.periodEnd < dto.periodStart) {
      throw new BadRequestException('周期结束时间不能早于开始时间');
    }

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
      actualIncome: actualIncome ? actualIncome.toDbCents() : null,
      actualExpense: actualExpense ? actualExpense.toDbCents() : null,
      actualNet: actualNet.toDbCents(),
      diffAmount: diffAmount.toDbCents(),
      settlementBatchNo: trimOptionalString(dto.settlementBatchNo),
      linkedOrderNos: dto.linkedOrderNos?.length
        ? dto.linkedOrderNos
            .map((s) => s.trim())
            .filter(Boolean)
            .join(',')
        : null,
      linkedOrderCount: dto.linkedOrderCount ?? null,
      linkedReceivableAmount:
        dto.linkedReceivableAmount != null
          ? Money.fromInputYuan(dto.linkedReceivableAmount).toDbCents()
          : null,
      linkedSettledAmount:
        dto.linkedSettledAmount != null
          ? Money.fromInputYuan(dto.linkedSettledAmount).toDbCents()
          : null,
      linkedFeeAmount:
        dto.linkedFeeAmount != null
          ? Money.fromInputYuan(dto.linkedFeeAmount).toDbCents()
          : null,
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
    const { storeId } = await this.financeAccessService.getFinanceContext(user);
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

    if (record.status === FinanceReconciliationStatus.draft) {
      throw new ConflictException('草稿状态的对账单请先录入实际金额后再确认');
    }

    const adjustNote = trimOptionalString(dto.adjustNote);
    const hasDiff = record.diffAmount !== 0;

    if (hasDiff && !adjustNote) {
      throw new ConflictException('有差异的对账单须提供调整说明');
    }

    const newStatus = hasDiff
      ? FinanceReconciliationStatus.adjusted
      : FinanceReconciliationStatus.confirmed;

    // 状态机前置条件：只有 discrepancy 才能被确认/调整，条件更新 + 同事务回读保证原子性
    const updatedRecord = await this.prisma.$transaction(
      async (tx) =>
        updateReconciliationConfirmation(tx, {
          storeId,
          recordId,
          fromStatus: FinanceReconciliationStatus.discrepancy,
          status: newStatus,
          adjustNote,
        }),
      { timeout: TX_TIMEOUT_SHORT },
    );
    if (!updatedRecord) {
      throw new ConflictException('对账单已被其他操作处理，请刷新后重试');
    }

    await this.cacheInvalidatorService.invalidateFinanceDerived(storeId);

    return mapReconciliationRecord(updatedRecord);
  }

  async deleteReconciliation(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    const { storeId } = await this.financeAccessService.getFinanceContext(user);

    // 条件删除：仅草稿/差异单可删，命中 0 行时再查一次以区分 404 与 409
    const deleted = await deleteUnconfirmedReconciliationRecordEntity(
      this.prisma,
      { storeId, recordId },
    );
    if (!deleted) {
      const record = await findReconciliationRecord(this.prisma, {
        storeId,
        recordId,
      });
      if (!record) {
        throw new NotFoundException('对账单不存在');
      }
      throw new ConflictException('已确认或已调整的对账单不能删除');
    }

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

  private async loadReconciliationStats(
    storeId: number,
  ): Promise<FinanceReconciliationStatsDto> {
    const rows = await queryReconciliationStatsRows(this.prisma, {
      storeId,
      now: Date.now(),
    });
    return buildReconciliationStats(rows);
  }
}
