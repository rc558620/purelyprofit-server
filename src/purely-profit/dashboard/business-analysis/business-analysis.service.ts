import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { GetBusinessAnalysisQueryDto } from './dto/business-analysis-query.dto';
import type { BusinessAnalysisResponseDto } from './dto/business-analysis-response.dto';
import {
  aggregateCosts,
  aggregateSales,
  createEmptyCostAggregation,
  createEmptySalesAggregation,
} from './business-analysis.domain';
import { buildBusinessAnalysisResponse, buildEmptyAnalysisResponse } from './business-analysis.mapper';
import { fetchBusinessAnalysisRows } from './business-analysis.query';
import { getPreviousRange, resolveCurrentRange } from './business-analysis.utils';

@Injectable()
export class BusinessAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getAnalysis(
    user: AuthenticatedUser,
    query: GetBusinessAnalysisQueryDto,
  ): Promise<BusinessAnalysisResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店经营分析',
    );

    return this.getAnalysisByStoreId(storeId, query);
  }

  async getAnalysisByStoreId(
    storeId: number,
    query: GetBusinessAnalysisQueryDto,
  ): Promise<BusinessAnalysisResponseDto> {
    if (query.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(storeId);
    }

    const currentRange = resolveCurrentRange(query);
    const previousRange = getPreviousRange(currentRange.start, currentRange.end);
    const [clampedCurrentRange, clampedPreviousRange] = await Promise.all([
      this.platformMembershipAccessService.clampHistoryRange(storeId, currentRange),
      this.platformMembershipAccessService.clampHistoryRange(storeId, previousRange),
    ]);

    if (clampedCurrentRange.empty) {
      return buildEmptyAnalysisResponse();
    }

    const { saleItems, costRows } = await fetchBusinessAnalysisRows(
      this.prisma,
      storeId,
      clampedCurrentRange,
      clampedPreviousRange,
    );

    const currentSales = aggregateSales(
      saleItems,
      clampedCurrentRange.start,
      clampedCurrentRange.end,
    );
    const previousSales = clampedPreviousRange.empty
      ? createEmptySalesAggregation()
      : aggregateSales(
          saleItems,
          clampedPreviousRange.start,
          clampedPreviousRange.end,
        );
    const currentCosts = aggregateCosts(
      costRows,
      clampedCurrentRange.start,
      clampedCurrentRange.end,
    );
    const previousCosts = clampedPreviousRange.empty
      ? createEmptyCostAggregation()
      : aggregateCosts(
          costRows,
          clampedPreviousRange.start,
          clampedPreviousRange.end,
        );

    return buildBusinessAnalysisResponse({
      currentRange: clampedCurrentRange,
      currentSales,
      previousSales,
      currentCosts,
      previousCosts,
    });
  }
}
