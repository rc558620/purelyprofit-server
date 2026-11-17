import type { PaginatedFinanceAccountsResponseDto } from './dto/finance-account.response.dto';
import type { ListFinanceCashFlowRecordsQueryDto } from './dto/finance-cash-flow.query.dto';
import type { PaginatedFinanceCashFlowRecordsResponseDto } from './dto/finance-cash-flow.response.dto';
import type { PaginatedFinanceReconciliationsResponseDto } from './dto/finance-reconciliation.response.dto';
import { mapAccountRecord } from './finance-account.domain';
import { mapCashFlowRecord } from './finance-cash-flow.domain';
import { mapReconciliationRecord } from './finance-reconciliation.domain';
import type { FinanceReportQueryDto } from './dto/finance-report.query.dto';
import type {
  FinanceAccountRecordWithAmount,
  FinanceCashFlowListQueryInput,
  FinanceCashFlowRecordWithAmount,
  FinanceReconciliationRecordWithItems,
  FinanceReportQueryInput,
  PaginationState,
} from './finance.types';
import { buildPaginationMeta } from './finance-pagination.utils';

/**
 * DTO → 内部查询入参的单一映射点。
 *
 * 流水列表与流水统计共用同一套筛选字段，此前两处各自手抄 13 行映射：
 * 新增筛选项时极易只改一处，造成「列表按新条件过滤、统计仍按旧条件」的口径漂移。
 */
export function buildCashFlowQueryInput(
  query: ListFinanceCashFlowRecordsQueryDto,
): FinanceCashFlowListQueryInput {
  return {
    period: query.period,
    directionFilter: query.directionFilter,
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
}

/**
 * 财务报表 DTO → 内部查询入参。
 *
 * 页面读取与 CSV 导出共用同一份解析结果（导出时由 controller 显式把 export 置为 true），
 * 避免两处各写一遍字段映射后出现「导出区间和页面区间不一致」。
 */
export function buildFinanceReportQueryInput(
  query: FinanceReportQueryDto,
): FinanceReportQueryInput {
  return {
    period: query.period,
    year: query.year,
    customDate: query.customDate,
    rangeStartDate: query.rangeStartDate,
    rangeEndDate: query.rangeEndDate,
    export: query.export,
  };
}

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
  cursor: { hasMore: boolean; nextCursor: string | null },
): PaginatedFinanceAccountsResponseDto {
  return {
    items: records.map((record) => mapAccountRecord(record)),
    meta: buildPaginationMeta(pageState.page, pageState.pageSize, total),
    hasMore: cursor.hasMore,
    nextCursor: cursor.nextCursor,
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
