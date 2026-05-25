import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  ConfirmFinanceReconciliationDto,
  CreateFinanceAccountDto,
  CreateFinanceCashFlowRecordDto,
  CreateFinanceReconciliationDto,
  type FinanceOverviewQueryDto,
  type FinanceReportQueryDto,
  ListFinanceAccountsQueryDto,
  ListFinanceCashFlowRecordsQueryDto,
  ListFinanceReconciliationsQueryDto,
  type SettleFinanceAccountDto,
} from './dto/finance-query.dto';
import type {
  FinanceAccountRecordResponseDto,
  FinanceAccountsStatsDto,
  FinanceCashFlowRecordResponseDto,
  FinanceCashFlowStatsDto,
  FinanceOverviewResponseDto,
  FinanceReportResponseDto,
  FinanceReconciliationRecordResponseDto,
  FinanceReconciliationStatsDto,
  PaginatedFinanceAccountsResponseDto,
  PaginatedFinanceCashFlowRecordsResponseDto,
  PaginatedFinanceReconciliationsResponseDto,
} from './dto/finance-response.dto';
import { FinanceAccountService } from './finance-account.service';
import { FinanceCashFlowService } from './finance-cash-flow.service';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceReconciliationService } from './finance-reconciliation.service';

@Injectable()
export class FinanceService {
  constructor(
    private readonly financeOverviewService: FinanceOverviewService,
    private readonly financeCashFlowService: FinanceCashFlowService,
    private readonly financeAccountService: FinanceAccountService,
    private readonly financeReconciliationService: FinanceReconciliationService,
  ) {}

  getOverview(
    user: AuthenticatedUser,
    query: FinanceOverviewQueryDto,
  ): Promise<FinanceOverviewResponseDto> {
    return this.financeOverviewService.getOverview(user, query);
  }

  getReport(
    user: AuthenticatedUser,
    query: FinanceReportQueryDto,
  ): Promise<FinanceReportResponseDto> {
    return this.financeOverviewService.getReport(user, query);
  }

  listCashFlowRecords(
    user: AuthenticatedUser,
    query: ListFinanceCashFlowRecordsQueryDto,
  ): Promise<PaginatedFinanceCashFlowRecordsResponseDto> {
    return this.financeCashFlowService.listCashFlowRecords(user, query);
  }

  getCashFlowStats(
    user: AuthenticatedUser,
    query: ListFinanceCashFlowRecordsQueryDto,
  ): Promise<FinanceCashFlowStatsDto> {
    return this.financeCashFlowService.getCashFlowStats(user, query);
  }

  createCashFlowRecord(
    user: AuthenticatedUser,
    dto: CreateFinanceCashFlowRecordDto,
  ): Promise<FinanceCashFlowRecordResponseDto> {
    return this.financeCashFlowService.createCashFlowRecord(user, dto);
  }

  deleteCashFlowRecord(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    return this.financeCashFlowService.deleteCashFlowRecord(user, recordId);
  }

  listAccounts(
    user: AuthenticatedUser,
    query: ListFinanceAccountsQueryDto,
  ): Promise<PaginatedFinanceAccountsResponseDto> {
    return this.financeAccountService.listAccounts(user, query);
  }

  getAccountsStats(user: AuthenticatedUser): Promise<FinanceAccountsStatsDto> {
    return this.financeAccountService.getAccountsStats(user);
  }

  createAccount(
    user: AuthenticatedUser,
    dto: CreateFinanceAccountDto,
  ): Promise<FinanceAccountRecordResponseDto> {
    return this.financeAccountService.createAccount(user, dto);
  }

  settleAccount(
    user: AuthenticatedUser,
    recordId: number,
    dto: SettleFinanceAccountDto,
  ): Promise<FinanceAccountRecordResponseDto> {
    return this.financeAccountService.settleAccount(user, recordId, dto);
  }

  deleteAccount(user: AuthenticatedUser, recordId: number): Promise<void> {
    return this.financeAccountService.deleteAccount(user, recordId);
  }

  listReconciliations(
    user: AuthenticatedUser,
    query: ListFinanceReconciliationsQueryDto,
  ): Promise<PaginatedFinanceReconciliationsResponseDto> {
    return this.financeReconciliationService.listReconciliations(user, query);
  }

  getReconciliationStats(
    user: AuthenticatedUser,
  ): Promise<FinanceReconciliationStatsDto> {
    return this.financeReconciliationService.getReconciliationStats(user);
  }

  createReconciliation(
    user: AuthenticatedUser,
    dto: CreateFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    return this.financeReconciliationService.createReconciliation(user, dto);
  }

  confirmReconciliation(
    user: AuthenticatedUser,
    recordId: number,
    dto: ConfirmFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    return this.financeReconciliationService.confirmReconciliation(
      user,
      recordId,
      dto,
    );
  }

  deleteReconciliation(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    return this.financeReconciliationService.deleteReconciliation(user, recordId);
  }
}
