import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import {
  CreateFinanceAccountDto,
  ListFinanceAccountsQueryDto,
  SettleFinanceAccountDto,
} from './dto/finance-query.dto';
import type {
  FinanceAccountRecordResponseDto,
  FinanceAccountsStatsDto,
  PaginatedFinanceAccountsResponseDto,
} from './dto/finance-response.dto';
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
  findAccountRecordId,
  queryAccountRecords,
  queryAccountStatsRows,
  updateAccountRecordSettlement,
} from './finance-account.query';
import { buildPaginatedAccountsResponse } from './finance.mapper';
import type { FinanceAccountsListQueryInput } from './finance.types';
import {
  buildPaginationState,
  roundMoneyValue,
  toMoneyNumber,
  toPrismaDecimal,
  trimOptionalString,
} from './finance.utils';

@Injectable()
export class FinanceAccountService {
  constructor(
    private readonly prisma: PrismaService,
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
      page: query.page,
      pageSize: query.pageSize,
    };
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

  async getAccountsStats(
    user: AuthenticatedUser,
  ): Promise<FinanceAccountsStatsDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const records = await queryAccountStatsRows(this.prisma, storeId);
    return buildAccountsStats(records);
  }

  async createAccount(
    user: AuthenticatedUser,
    dto: CreateFinanceAccountDto,
  ): Promise<FinanceAccountRecordResponseDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const operatorStaffId = user.currentMembership?.staffId ?? null;
    const amount = roundMoneyValue(dto.amount);
    const paidAmount = roundMoneyValue(dto.paidAmount);

    assertAccountCategoryCanCreateManually(dto.category);
    assertAccountTypeMatchesCategory(dto.type, dto.category);

    if (paidAmount > amount) {
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
      amount: toPrismaDecimal(amount),
      paidAmount: toPrismaDecimal(paidAmount),
      remaining: toPrismaDecimal(derived.remaining),
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
    const record = await findAccountRecord(this.prisma, { storeId, recordId });
    if (!record) {
      throw new NotFoundException('账款记录不存在');
    }

    const currentPaidAmount = toMoneyNumber(record.paidAmount);
    const amount = toMoneyNumber(record.amount);
    const payAmount = roundMoneyValue(dto.payAmount);
    const nextPaidAmount = roundMoneyValue(currentPaidAmount + payAmount);
    if (nextPaidAmount > amount) {
      throw new ConflictException('本次收付金额超过剩余金额');
    }
    const derived = deriveAccountFields(
      amount,
      nextPaidAmount,
      record.dueDate?.getTime() ?? undefined,
    );
    const updatedRecord = await updateAccountRecordSettlement(this.prisma, {
      recordId,
      paidAmount: toPrismaDecimal(nextPaidAmount),
      remaining: toPrismaDecimal(derived.remaining),
      status: derived.status,
    });

    await this.invalidateDashboardCaches(storeId);

    return mapAccountRecord(updatedRecord);
  }

  async deleteAccount(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const record = await findAccountRecordId(this.prisma, {
      storeId,
      recordId,
    });
    if (!record) {
      throw new NotFoundException('账款记录不存在');
    }
    await deleteAccountRecordEntity(this.prisma, recordId);
    await this.invalidateDashboardCaches(storeId);
  }

  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await this.cacheInvalidatorService.invalidateDashboardAndPulseSession(
      storeId,
    );
  }
}
