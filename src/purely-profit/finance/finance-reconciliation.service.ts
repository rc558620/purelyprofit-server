import { Injectable, NotFoundException } from '@nestjs/common';
import { FinanceReconciliationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConfirmFinanceReconciliationDto,
  CreateFinanceReconciliationDto,
  ListFinanceReconciliationsQueryDto,
} from './dto/finance-query.dto';
import type {
  FinanceReconciliationRecordResponseDto,
  FinanceReconciliationStatsDto,
  PaginatedFinanceReconciliationsResponseDto,
} from './dto/finance-response.dto';
import {
  buildReconciliationItemCreateInput,
  buildReconciliationStats,
  filterReconciliations,
  mapReconciliationRecord,
  normalizeCreateReconciliationStatus,
} from './finance-reconciliation.domain';
import { FinanceAccessService } from './finance-access.service';
import {
  createReconciliationRecordEntity,
  deleteReconciliationRecordEntity,
  findReconciliationRecord,
  findReconciliationRecordId,
  queryReconciliationRecords,
  updateReconciliationConfirmation,
} from './finance-reconciliation.query';
import { buildPaginatedReconciliationsResponse } from './finance.mapper';
import type { FinanceReconciliationsListQueryInput } from './finance.types';
import {
  buildPaginationState,
  roundMoneyValue,
  toPrismaDecimal,
  trimOptionalString,
} from './finance.utils';

@Injectable()
export class FinanceReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeAccessService: FinanceAccessService,
  ) {}

  async listReconciliations(
    user: AuthenticatedUser,
    query: ListFinanceReconciliationsQueryDto,
  ): Promise<PaginatedFinanceReconciliationsResponseDto> {
    const storeId = await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const records = await queryReconciliationRecords(this.prisma, storeId);
    const reconciliationQuery: FinanceReconciliationsListQueryInput = {
      statusFilter: query.statusFilter,
      typeFilter: query.typeFilter,
      searchText: query.searchText,
      page: query.page,
      pageSize: query.pageSize,
    };
    const filteredRecords = filterReconciliations(records, reconciliationQuery);
    const pageState = buildPaginationState(
      reconciliationQuery.page,
      reconciliationQuery.pageSize,
    );

    return buildPaginatedReconciliationsResponse(filteredRecords, pageState);
  }

  async getReconciliationStats(
    user: AuthenticatedUser,
  ): Promise<FinanceReconciliationStatsDto> {
    const storeId = await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const records = await queryReconciliationRecords(this.prisma, storeId);
    return buildReconciliationStats(records);
  }

  async createReconciliation(
    user: AuthenticatedUser,
    dto: CreateFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    const storeId = await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const operatorStaffId = user.currentMembership?.staffId ?? null;
    const bookIncome = roundMoneyValue(dto.bookIncome);
    const bookExpense = roundMoneyValue(dto.bookExpense);
    const actualIncome = roundMoneyValue(dto.actualIncome);
    const actualExpense = roundMoneyValue(dto.actualExpense);
    const bookNet = roundMoneyValue(bookIncome - bookExpense);
    const actualNet = roundMoneyValue(actualIncome - actualExpense);
    const diffAmount = roundMoneyValue(actualNet - bookNet);
    const status = normalizeCreateReconciliationStatus(
      dto.status,
      actualIncome,
      actualExpense,
      diffAmount,
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
      bookIncome: toPrismaDecimal(bookIncome),
      bookExpense: toPrismaDecimal(bookExpense),
      bookNet: toPrismaDecimal(bookNet),
      actualIncome: toPrismaDecimal(actualIncome),
      actualExpense: toPrismaDecimal(actualExpense),
      actualNet: toPrismaDecimal(actualNet),
      diffAmount: toPrismaDecimal(diffAmount),
      operator: trimOptionalString(dto.operator),
      note: trimOptionalString(dto.note),
      date: new Date(dto.date),
      items: {
        create: items,
      },
    });

    return mapReconciliationRecord(createdRecord);
  }

  async confirmReconciliation(
    user: AuthenticatedUser,
    recordId: number,
    dto: ConfirmFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    const storeId = await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const record = await findReconciliationRecord(this.prisma, {
      storeId,
      recordId,
    });
    if (!record) {
      throw new NotFoundException('对账单不存在');
    }

    const adjustNote = trimOptionalString(dto.adjustNote);
    const updatedRecord = await updateReconciliationConfirmation(this.prisma, {
      recordId,
      status: adjustNote
        ? FinanceReconciliationStatus.adjusted
        : FinanceReconciliationStatus.confirmed,
      adjustNote,
    });

    return mapReconciliationRecord(updatedRecord);
  }

  async deleteReconciliation(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    const storeId = await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const record = await findReconciliationRecordId(this.prisma, {
      storeId,
      recordId,
    });
    if (!record) {
      throw new NotFoundException('对账单不存在');
    }
    await deleteReconciliationRecordEntity(this.prisma, recordId);
  }

}
