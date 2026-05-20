import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { BusinessAnalysisModule } from '../../dashboard/business-analysis/business-analysis.module';
import { DashboardAggregatorService } from './dashboard-aggregator.service';
import { PulseDashboardController } from './dashboard.controller';
import { PulseDashboardService } from './dashboard.service';

@Module({
  imports: [AuthModule, BusinessAnalysisModule],
  controllers: [PulseDashboardController],
  providers: [DashboardAggregatorService, PulseDashboardService],
})
export class PulseDashboardModule {}
