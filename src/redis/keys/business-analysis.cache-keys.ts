import {
  BUSINESS_ANALYSIS_PERIOD_VALUES,
  BUSINESS_ANALYSIS_RANK_SORT_VALUES,
  DEFAULT_BUSINESS_ANALYSIS_RANK_SORT,
  type BusinessAnalysisPeriod,
  type BusinessAnalysisRankSort,
} from '../../purely-profit/dashboard/business-analysis/business-analysis.types';

type BusinessAnalysisCacheQuery = {
  period?: string | null;
  startTime?: number | null;
  endTime?: number | null;
  rankSort?: string | null;
};

function isBusinessAnalysisPeriod(
  value: string,
): value is BusinessAnalysisPeriod {
  return (BUSINESS_ANALYSIS_PERIOD_VALUES as readonly string[]).includes(value);
}

function isBusinessAnalysisRankSort(
  value: string,
): value is BusinessAnalysisRankSort {
  return (BUSINESS_ANALYSIS_RANK_SORT_VALUES as readonly string[]).includes(
    value,
  );
}

export function buildBusinessAnalysisCacheKey(
  storeId: number,
  query: BusinessAnalysisCacheQuery,
): string {
  return [
    'profit:business-analysis',
    `store:${storeId}`,
    `period:${query.period}`,
    `start:${query.startTime ?? 'na'}`,
    `end:${query.endTime ?? 'na'}`,
    // 排行结果依赖服务端排序维度，必须进入缓存键，否则切换排序维度会命中
    // 上一维度截断后的旧数据。
    `rank:${query.rankSort ?? DEFAULT_BUSINESS_ANALYSIS_RANK_SORT}`,
  ].join(':');
}

export function buildBusinessAnalysisPattern(storeId: number): string {
  return `profit:business-analysis:store:${storeId}:*`;
}

export function buildBusinessAnalysisAllPattern(): string {
  return 'profit:business-analysis:store:*:period:*:start:*:end:*:rank:*';
}

export function parseBusinessAnalysisCacheKey(cacheKey: string): {
  storeId: number;
  period: BusinessAnalysisPeriod;
  startTime?: number;
  endTime?: number;
  rankSort: BusinessAnalysisRankSort;
} | null {
  const match =
    /^profit:business-analysis:store:(\d+):period:([^:]+):start:([^:]+):end:([^:]+):rank:([^:]+)$/.exec(
      cacheKey,
    );
  if (!match) {
    return null;
  }

  const [, rawStoreId, rawPeriod, rawStartTime, rawEndTime, rawRankSort] =
    match;
  if (!isBusinessAnalysisPeriod(rawPeriod)) {
    return null;
  }
  if (!isBusinessAnalysisRankSort(rawRankSort)) {
    return null;
  }

  return {
    storeId: Number(rawStoreId),
    period: rawPeriod,
    startTime: rawStartTime === 'na' ? undefined : Number(rawStartTime),
    endTime: rawEndTime === 'na' ? undefined : Number(rawEndTime),
    rankSort: rawRankSort,
  };
}
