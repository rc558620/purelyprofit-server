import type {
  PaginatedFinanceAccountsResponseDto,
  PaginatedFinanceCashFlowRecordsResponseDto,
  PaginatedFinanceReconciliationsResponseDto,
} from './dto/finance-response.dto';
import { mapAccountRecord } from './finance-account.domain';
import { mapCashFlowRecord } from './finance-cash-flow.domain';
import { mapReconciliationRecord } from './finance-reconciliation.domain';
import type {
  FinanceAccountRecordWithAmount,
  FinanceCashFlowRecordWithAmount,
  FinanceReconciliationRecordWithItems,
  PaginationState,
} from './finance.types';
import { buildPaginationMeta, paginateArray } from './finance.utils';

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
  filteredRecords: FinanceReconciliationRecordWithItems[],
  pageState: PaginationState,
): PaginatedFinanceReconciliationsResponseDto {
  const pagination = buildPaginationMeta(
    pageState.page,
    pageState.pageSize,
    filteredRecords.length,
  );

  return {
    items: paginateArray(filteredRecords, pagination).map((record) =>
      mapReconciliationRecord(record),
    ),
    meta: pagination,
  };
}
