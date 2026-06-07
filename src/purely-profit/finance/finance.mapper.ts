import type { PaginatedFinanceAccountsResponseDto } from './dto/finance-account.response.dto';
import type { PaginatedFinanceCashFlowRecordsResponseDto } from './dto/finance-cash-flow.response.dto';
import type { PaginatedFinanceReconciliationsResponseDto } from './dto/finance-reconciliation.response.dto';
import { mapAccountRecord } from './finance-account.domain';
import { mapCashFlowRecord } from './finance-cash-flow.domain';
import { mapReconciliationRecord } from './finance-reconciliation.domain';
import type {
  FinanceAccountRecordWithAmount,
  FinanceCashFlowRecordWithAmount,
  FinanceReconciliationRecordWithItems,
  PaginationState,
} from './finance.types';
import { buildPaginationMeta } from './finance-pagination.utils';

export function buildPaginatedCashFlowRecordsResponse(
  records: FinanceCashFlowRecordWithAmount[],
  pageState: PaginationState,
  total: number,
): PaginatedFinanceCashFlowRecordsResponseDto {
  return {
    items: records.map((record) => mapCashFlowRecord(record)),
    meta: buildPaginationMeta(pageState.page, pageState.pageSize, total),
  };
}

export function buildPaginatedAccountsResponse(
  records: FinanceAccountRecordWithAmount[],
  pageState: PaginationState,
  total: number,
): PaginatedFinanceAccountsResponseDto {
  return {
    items: records.map((record) => mapAccountRecord(record)),
    meta: buildPaginationMeta(pageState.page, pageState.pageSize, total),
  };
}

export function buildPaginatedReconciliationsResponse(
  records: FinanceReconciliationRecordWithItems[],
  pageState: PaginationState,
  total: number,
): PaginatedFinanceReconciliationsResponseDto {
  return {
    items: records.map((record) => mapReconciliationRecord(record)),
    meta: buildPaginationMeta(pageState.page, pageState.pageSize, total),
  };
}
