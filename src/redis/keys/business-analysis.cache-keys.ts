import {
  BUSINESS_ANALYSIS_PERIOD_VALUES,
  type BusinessAnalysisPeriod,
} from '../../purely-profit/dashboard/business-analysis/business-analysis.types';

type BusinessAnalysisCacheQuery = {
  period?: string | null;
  startTime?: number | null;
  endTime?: number | null;
};

function isBusinessAnalysisPeriod(
  value: string,
): value is BusinessAnalysisPeriod {
  return (BUSINESS_ANALYSIS_PERIOD_VALUES as readonly string[]).includes(value);
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
  ].join(':');
}

export function buildBusinessAnalysisPattern(storeId: number): string {
  return `profit:business-analysis:store:${storeId}:*`;
}

export function buildBusinessAnalysisAllPattern(): string {
  return 'profit:business-analysis:store:*:period:*:start:*:end:*';
}

export function parseBusinessAnalysisCacheKey(cacheKey: string): {
  storeId: number;
  period: BusinessAnalysisPeriod;
  startTime?: number;
  endTime?: number;
} | null {
  const match =
    /^profit:business-analysis:store:(\d+):period:([^:]+):start:([^:]+):end:([^:]+)$/.exec(
      cacheKey,
    );
  if (!match) {
    return null;
  }

  const [, rawStoreId, rawPeriod, rawStartTime, rawEndTime] = match;
  if (!isBusinessAnalysisPeriod(rawPeriod)) {
    return null;
  }

  return {
    storeId: Number(rawStoreId),
    period: rawPeriod,
    startTime: rawStartTime === 'na' ? undefined : Number(rawStartTime),
    endTime: rawEndTime === 'na' ? undefined : Number(rawEndTime),
  };
}
