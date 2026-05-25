import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { subtractMoneyValues } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { GetProfitDetailQueryDto } from './dto/profit-detail-query.dto';
import type {
  ProfitDetailResponseDto,
  ProfitReportResponseDto,
} from './dto/profit-detail-response.dto';
import type {
  ProfitDetailQueryInput,
  ProfitMetricsSnapshot,
} from './profit-detail.types';
import { aggregateCosts, aggregateSales, createEmptySalesAggregation } from './profit-detail.domain';
import {
  buildEmptyProfitDetailResponse,
  buildEmptyProfitReportResponse,
  buildProfitDetailResponse,
  buildProfitReportResponse,
} from './profit-detail.mapper';
import { fetchProfitRows } from './profit-detail.query';
import {
  buildClampedRanges,
  buildCurrentRange,
  buildPreviousRange,
  buildQueryInput,
} from './profit-detail.utils';

@Injectable()
export class ProfitDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getProfitDetail(
    user: AuthenticatedUser,
    queryDto: GetProfitDetailQueryDto,
  ): Promise<ProfitDetailResponseDto> {
    const query = buildQueryInput(queryDto);
    const storeId = await this.resolveStoreId(
      user,
      query.storeId,
      '无权查看该门店利润详情',
    );
    const snapshot = await this.buildProfitSnapshot(storeId, query);

    if (!snapshot) {
      return buildEmptyProfitDetailResponse();
    }

    return buildProfitDetailResponse(snapshot);
  }

  async getReport(
    user: AuthenticatedUser,
    queryDto: GetProfitDetailQueryDto,
  ): Promise<ProfitReportResponseDto> {
    const query = buildQueryInput(queryDto);
    const storeId = await this.resolveStoreId(
      user,
      query.storeId,
      '无权查看该门店利润报表',
    );

    if (queryDto.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(storeId);
    }

    const snapshot = await this.buildProfitSnapshot(storeId, query);

    if (!snapshot) {
      return buildEmptyProfitReportResponse();
    }

    return buildProfitReportResponse(snapshot);
  }

  private resolveStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    forbiddenMessage: string,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      storeId,
      'report:view',
      forbiddenMessage,
    );
  }

  private async buildProfitSnapshot(
    storeId: number,
    query: ProfitDetailQueryInput,
  ): Promise<ProfitMetricsSnapshot | null> {
    const currentRange = buildCurrentRange(query);
    const previousRange = buildPreviousRange(query, currentRange);
    const {
      currentRange: clampedCurrentRange,
      previousRange: clampedPreviousRange,
    } = await buildClampedRanges(
      this.platformMembershipAccessService,
      storeId,
      currentRange,
      previousRange,
    );

    if (clampedCurrentRange.empty) {
      return null;
    }

    const { saleRows, costRows } = await fetchProfitRows(
      this.prisma,
      storeId,
      clampedCurrentRange,
      clampedPreviousRange,
    );
    const currentSales = aggregateSales(
      saleRows,
      clampedCurrentRange.start,
      clampedCurrentRange.end,
    );
    const previousSales = clampedPreviousRange.empty
      ? createEmptySalesAggregation()
      : aggregateSales(
          saleRows,
          clampedPreviousRange.start,
          clampedPreviousRange.end,
        );
    const currentCosts = aggregateCosts(
      costRows,
      clampedCurrentRange.start,
      clampedCurrentRange.end,
    );

    return {
      currentRange: clampedCurrentRange,
      currentSales,
      previousSales,
      currentCosts,
      netProfit: subtractMoneyValues(
        currentSales.revenue,
        currentCosts.totalCost,
      ),
    };
  }
}
