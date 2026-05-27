import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { BusinessAnalysisModule } from '../../purely-profit/dashboard/business-analysis/business-analysis.module';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { DashboardAggregatorService } from './dashboard-aggregator.service';
import {
  PulseDashboardController,
  RevenueDetailController,
} from './dashboard.controller';
import { PulseDashboardHomeService } from './dashboard-home.service';
import { PulseDashboardOverviewService } from './dashboard-overview.service';
import { PulseDashboardRevenueDetailService } from './dashboard-revenue-detail.service';
import { PulseDashboardService } from './dashboard.service';

@Module({
  imports: [AuthModule, BusinessAnalysisModule, PulseStoreContextModule],
  controllers: [PulseDashboardController, RevenueDetailController],
  providers: [
    DashboardAggregatorService,
    PulseDashboardOverviewService,
    PulseDashboardHomeService,
    PulseDashboardRevenueDetailService,
    PulseDashboardService,
  ],
})
export class PulseDashboardModule {}
