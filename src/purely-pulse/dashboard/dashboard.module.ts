import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { BusinessAnalysisModule } from '../../purely-profit/dashboard/business-analysis/business-analysis.module';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { DashboardAggregatorService } from './dashboard-aggregator.service';
import {
  PulseDashboardController,
  RevenueDetailController,
} from './dashboard.controller';
import { PulseDashboardService } from './dashboard.service';

@Module({
  imports: [AuthModule, BusinessAnalysisModule, PulseStoreContextModule],
  controllers: [PulseDashboardController, RevenueDetailController],
  providers: [DashboardAggregatorService, PulseDashboardService],
})
export class PulseDashboardModule {}
