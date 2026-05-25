import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { GetDashboardHomeOverviewQueryDto } from './dto/dashboard-home-query.dto';
import type { DashboardHomeOverviewResponseDto } from './dto/dashboard-home-response.dto';
import {
  aggregateDashboardHomeCostsByRange,
  aggregateDashboardHomeSalesByRange,
} from './dashboard-home.domain';
import { buildDashboardHomeOverviewResponse } from './dashboard-home.mapper';
import { loadDashboardHomeOverviewData } from './dashboard-home.query';
import { buildCompareRange, buildCurrentRange, buildDashboardHomeQueryInput } from './dashboard-home.utils';

@Injectable()
export class DashboardHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    queryDto: GetDashboardHomeOverviewQueryDto,
  ): Promise<DashboardHomeOverviewResponseDto> {
    const query = buildDashboardHomeQueryInput(queryDto);
    const period = query.period ?? 'today';
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店首页概览',
    );

    const currentRange = buildCurrentRange(period);
    const compareRange = buildCompareRange(period, currentRange);
    const now = Date.now();
    const overviewData = await loadDashboardHomeOverviewData(this.prisma, {
      storeId,
      currentRange,
      compareRange,
      now,
    });

    const currentSales = aggregateDashboardHomeSalesByRange(
      overviewData.saleOrders,
      currentRange.start,
      currentRange.end,
    );
    const compareSales = aggregateDashboardHomeSalesByRange(
      overviewData.saleOrders,
      compareRange.start,
      compareRange.end,
    );
    const currentCosts = aggregateDashboardHomeCostsByRange(
      overviewData.costRecords,
      currentRange.start,
      currentRange.end,
    );
    const compareCosts = aggregateDashboardHomeCostsByRange(
      overviewData.costRecords,
      compareRange.start,
      compareRange.end,
    );

    return buildDashboardHomeOverviewResponse({
      period,
      storeId,
      currentRange,
      compareRange,
      now,
      overviewData,
      currentSales,
      compareSales,
      currentCosts,
      compareCosts,
    });
  }
}
