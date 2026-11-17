import type { PrismaService } from '../../prisma/prisma.service';
import type { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import type { FinanceReportResponseDto } from './dto/finance-report.response.dto';
import {
  buildFinanceReportRows,
  buildFinanceReportSummary,
} from './finance-account-report.domain';
import type { FinanceRequestContext } from './finance-access.service';
import {
  queryFinanceReportRows,
  queryFinanceReportSummary,
} from './finance-overview-report.query';
import {
  getFinanceReportRange,
  getPreviousFinanceReportRange,
} from './finance-range.utils';
import {
  FINANCE_REPORT_CACHE_TTL_SECONDS,
  FINANCE_REPORT_REFRESH_AFTER_MS,
  FINANCE_REPORT_ROWS_CACHE_TTL_SECONDS,
  FINANCE_REPORT_ROWS_REFRESH_AFTER_MS,
} from './finance.constants';
import {
  buildFinanceReportCacheKey,
  type FinanceReportCachePart,
} from './finance.cache-keys';
import type { FinanceReportQueryInput } from './finance.types';

/**
 * 报表两个缓存 part 的取数入口。
 *
 * 报表拆成 summary / rows 两个 key（见 `finance.cache-keys`），
 * 因此取数也必须拆成互不依赖的两条：概况只跑聚合 SQL，明细行只取渲染用行。
 * 抽到独立文件是为了让 service 只保留编排（缓存读写、导出、区间裁剪入口），
 * 不把 SQL 与 DTO 映射堆在同一个类里。
 */

/** 概况 part 的缓存值类型：7 个数字，已映射为响应 DTO */
export type FinanceReportSummaryValue = FinanceReportResponseDto['summary'];

/**
 * 明细 part 的缓存值类型：已映射为 DTO（日期转 label、金额转元）。
 *
 * 缓存里存映射后的 DTO 而不是 Prisma 原始行，读回来无需反解 Date，
 * 避免「命中缓存」与「回源」两条路径产出结构不一致。
 */
export type FinanceReportRowsValue = ReturnType<typeof buildFinanceReportRows>;

type ReportRange = { start: number; end: number; empty: boolean };

/** 本期 / 上期区间共用同一份会员历史窗口，裁剪为纯内存计算 */
export function resolveFinanceReportRanges(
  context: FinanceRequestContext,
  reportQuery: FinanceReportQueryInput,
): { currentRange: ReportRange; previousRange: ReportRange | null } {
  const range = getFinanceReportRange(reportQuery);
  const previousRange = getPreviousFinanceReportRange(reportQuery, range);

  return {
    currentRange: context.clamp(range),
    previousRange: previousRange ? context.clamp(previousRange) : null,
  };
}

/** 概况 part：只跑 3 条聚合 SQL，不带任何明细行 */
export async function loadFinanceReportSummary(
  prisma: PrismaService,
  context: FinanceRequestContext,
  reportQuery: FinanceReportQueryInput,
): Promise<FinanceReportSummaryValue> {
  const { currentRange, previousRange } = resolveFinanceReportRanges(
    context,
    reportQuery,
  );
  const data = await queryFinanceReportSummary(prisma, {
    storeId: context.storeId,
    currentRange,
    previousRange,
  });

  return buildFinanceReportSummary(data);
}

/** 明细 part：只取渲染用的行，不参与任何金额汇总 */
export async function loadFinanceReportRows(
  prisma: PrismaService,
  context: FinanceRequestContext,
  reportQuery: FinanceReportQueryInput,
): Promise<FinanceReportRowsValue> {
  const { currentRange } = resolveFinanceReportRanges(context, reportQuery);
  const data = await queryFinanceReportRows(prisma, {
    storeId: context.storeId,
    currentRange,
  });

  return buildFinanceReportRows(data);
}

/**
 * 按 part 定向回写报表缓存（预热链路用）。
 *
 * 只重建 `part` 对应的一半：rows 的明细查询不必为了刷新概况白跑一遍，
 * 反之亦然。key 由同一份 `buildFinanceReportCacheKey` 生成，
 * 与请求路径读写的是同一批 key，不会出现「预热写了没人读」的孤儿 key。
 */
export async function warmFinanceReportPart(params: {
  cache: RefreshableCacheService;
  prisma: PrismaService;
  context: FinanceRequestContext;
  reportQuery: FinanceReportQueryInput;
  part: FinanceReportCachePart;
}): Promise<void> {
  const { context, reportQuery, part } = params;
  const scope = context.callerIsSubAccount ? 'sub_account' : 'owner';
  const cacheKey = buildFinanceReportCacheKey(
    context.storeId,
    { ...reportQuery, scope },
    part,
  );

  if (part === 'summary') {
    await params.cache.writeRefreshableJson(
      cacheKey,
      await loadFinanceReportSummary(params.prisma, context, reportQuery),
      FINANCE_REPORT_CACHE_TTL_SECONDS,
      FINANCE_REPORT_REFRESH_AFTER_MS,
    );
    return;
  }

  await params.cache.writeRefreshableJson(
    cacheKey,
    await loadFinanceReportRows(params.prisma, context, reportQuery),
    FINANCE_REPORT_ROWS_CACHE_TTL_SECONDS,
    FINANCE_REPORT_ROWS_REFRESH_AFTER_MS,
  );
}
