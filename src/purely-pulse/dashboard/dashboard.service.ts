import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { BusinessAnalysisResponseDto } from '../../purely-profit/dashboard/business-analysis/dto/business-analysis-response.dto';
import { PulseDashboardHomeService } from './dashboard-home.service';
import { PulseDashboardOverviewService } from './dashboard-overview.service';
import { PulseDashboardRevenueDetailService } from './dashboard-revenue-detail.service';
import type {
  GetPulseDashboardAnalysisQueryDto,
  GetPulseDashboardHomeQueryDto,
  GetPulseDashboardOverviewQueryDto,
  GetPulseDashboardStoresQueryDto,
  GetPulseRevenueDetailQueryDto,
} from './dto/pulse-dashboard-query.dto';
import type { PulseDashboardHomeResponseDto } from './dto/pulse-dashboard-home.response.dto';
import type {
  PulseDashboardOverviewResponseDto,
  PulseDashboardStoresResponseDto,
} from './dto/pulse-dashboard-overview.response.dto';
import type { PulseRevenueDetailResponseDto } from './dto/pulse-dashboard-revenue-detail.response.dto';

@Injectable()
export class PulseDashboardService {
  constructor(
    private readonly pulseDashboardOverviewService: PulseDashboardOverviewService,
    private readonly pulseDashboardHomeService: PulseDashboardHomeService,
    private readonly pulseDashboardRevenueDetailService: PulseDashboardRevenueDetailService,
  ) {}

  getOverview(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardOverviewQueryDto,
  ): Promise<PulseDashboardOverviewResponseDto> {
    return this.pulseDashboardOverviewService.getOverview(user, queryDto);
  }

  getStores(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardStoresQueryDto,
  ): Promise<PulseDashboardStoresResponseDto> {
    return this.pulseDashboardOverviewService.getStores(user, queryDto);
  }

  getAnalysis(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardAnalysisQueryDto,
  ): Promise<BusinessAnalysisResponseDto> {
    return this.pulseDashboardOverviewService.getAnalysis(user, queryDto);
  }

  getHome(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardHomeQueryDto,
  ): Promise<PulseDashboardHomeResponseDto> {
    return this.pulseDashboardHomeService.getHome(user, queryDto);
  }

  getRevenueDetail(
    user: AuthenticatedUser,
    queryDto: GetPulseRevenueDetailQueryDto,
  ): Promise<PulseRevenueDetailResponseDto> {
    return this.pulseDashboardRevenueDetailService.getRevenueDetail(
      user,
      queryDto,
    );
  }
}
