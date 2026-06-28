import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CreateFinanceAccountDto,
  ListFinanceAccountsQueryDto,
  type SettleFinanceAccountDto,
} from './dto/finance-account.query.dto';
import {
  CreateFinanceCashFlowRecordDto,
  ListFinanceCashFlowRecordsQueryDto,
} from './dto/finance-cash-flow.query.dto';
import type { FinanceOverviewQueryDto } from './dto/finance-overview.query.dto';
import {
  ConfirmFinanceReconciliationDto,
  CreateFinanceReconciliationDto,
  ListFinanceReconciliationsQueryDto,
} from './dto/finance-reconciliation.query.dto';
import type { FinanceReportQueryDto } from './dto/finance-report.query.dto';
import type {
  FinanceAccountRecordResponseDto,
  FinanceAccountsStatsDto,
  PaginatedFinanceAccountsResponseDto,
} from './dto/finance-account.response.dto';
import type {
  FinanceCashFlowRecordResponseDto,
  FinanceCashFlowStatsDto,
  PaginatedFinanceCashFlowRecordsResponseDto,
} from './dto/finance-cash-flow.response.dto';
import type { FinanceOverviewResponseDto } from './dto/finance-overview.response.dto';
import type { FinanceReportResponseDto } from './dto/finance-report.response.dto';
import type {
  FinanceReconciliationRecordResponseDto,
  FinanceReconciliationStatsDto,
  PaginatedFinanceReconciliationsResponseDto,
} from './dto/finance-reconciliation.response.dto';
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

  streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: FinanceReportQueryDto,
  ): Promise<void> {
    return this.financeOverviewService.streamReportCsv(reply, user, query);
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
    return this.financeReconciliationService.deleteReconciliation(
      user,
      recordId,
    );
  }
}
