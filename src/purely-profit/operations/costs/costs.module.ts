import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { CostsController } from './costs.controller';
import { CostsReadService } from './costs-read.service';
import { CostsReadRecordsService } from './costs-read-records.service';
import { CostsReadStatsService } from './costs-read-stats.service';
import { CostsReadReportService } from './costs-read-report.service';
import { CostsReadDashboardService } from './costs-read-dashboard.service';
import { CostsService } from './costs.service';
import { CostsWriteService } from './costs-write.service';

@Module({
  imports: [CommerceModule, PlatformMembershipModule],
  controllers: [CostsController],
  providers: [
    CostsReadService,
    CostsReadRecordsService,
    CostsReadStatsService,
    CostsReadReportService,
    CostsReadDashboardService,
    CostsWriteService,
    CostsService,
  ],
  exports: [CostsService, CostsReadService],
})
export class CostsModule {}
