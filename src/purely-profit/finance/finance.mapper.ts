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

/**
 * 现金流水列表响应组装。
 *
 * `cursor` 承载「到底判定」结果：游标路径由调用方的探测行（take = limit + 1）得出，
 * offset 路径由 `offset + 已取条数 < total` 得出，两条路径都恒有
 * `hasMore === (nextCursor !== null)`。原 items/meta 结构保持不变，只新增两个字段。
 */
export function buildPaginatedCashFlowRecordsResponse(
  records: FinanceCashFlowRecordWithAmount[],
  pageState: PaginationState,
  total: number,
  cursor: { hasMore: boolean; nextCursor: string | null },
): PaginatedFinanceCashFlowRecordsResponseDto {
  return {
    items: records.map((record) => mapCashFlowRecord(record)),
    meta: buildPaginationMeta(pageState.page, pageState.pageSize, total),
    hasMore: cursor.hasMore,
    nextCursor: cursor.nextCursor,
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
