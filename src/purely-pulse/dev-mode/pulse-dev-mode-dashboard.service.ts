import { Injectable } from '@nestjs/common';
import type { BusinessAnalysisResponseDto } from '../../purely-profit/dashboard/business-analysis/dto/business-analysis-response.dto';
import { buildCurrentRange } from '../dashboard/dashboard-time.utils';
import type { PulseDashboardPeriodValue } from '../dashboard/dto/pulse-dashboard-query.dto';
import type {
  PulseDashboardOverviewResponseDto,
  PulseDashboardStoresResponseDto,
} from '../dashboard/dto/pulse-dashboard-overview.response.dto';
import {
  PERIOD_ORDER_LABEL,
  PERIOD_PROFIT_LABEL,
} from './pulse-dev-mode.constants';

@Injectable()
export class PulseDevModeDashboardService {
  buildDashboardOverview(
    period: PulseDashboardPeriodValue,
  ): PulseDashboardOverviewResponseDto {
    const currentRange = buildCurrentRange(period);

    return {
      stats: {
        profitLabel: PERIOD_PROFIT_LABEL[period],
        profit: 0,
        profitChange: null,
        orderLabel: PERIOD_ORDER_LABEL[period],
        orderCount: 0,
        orderChange: null,
        revenue: 0,
        totalCost: 0,
      },
      salesTrend: {
        categories: [],
        actual: [],
        isYearMode: period === 'year',
      },
      meta: {
        period,
        storeId: null,
        storeCount: 0,
        startAt: currentRange.start,
        endAt: currentRange.end,
        generatedAt: Date.now(),
      },
    };
  }

  buildDashboardStores(
    period: PulseDashboardPeriodValue,
  ): PulseDashboardStoresResponseDto {
    const currentRange = buildCurrentRange(period);

    return {
      meta: {
        period,
        storeId: null,
        storeCount: 0,
        startAt: currentRange.start,
        endAt: currentRange.end,
        generatedAt: Date.now(),
      },
      stores: [],
    };
  }

  buildDashboardAnalysis(): BusinessAnalysisResponseDto {
    return {
      heroSummary: {
        netProfit: { current: 0, previous: 0, changeRate: null },
        revenue: { current: 0, previous: 0, changeRate: null },
        totalCost: { current: 0, previous: 0, changeRate: null },
        profitRate: { current: 0, previous: 0, changeRate: null },
        orderCount: 0,
      },
      dailyTrend: [],
      categoryShares: [],
      costRateItems: [],
      rankProducts: [],
    };
  }
}
