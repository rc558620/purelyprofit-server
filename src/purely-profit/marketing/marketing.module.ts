import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { PlatformMembershipModule } from '../member/platform-membership/platform-membership.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { MarketingAccessService } from './marketing-access.service';
import { MarketingConsumptionsService } from './marketing-consumptions.service';
import { MarketingController } from './marketing.controller';
import { MarketingCustomersService } from './marketing-customers.service';
import { MarketingOverviewService } from './marketing-overview.service';
import { MarketingPointsRecordsService } from './marketing-points-records.service';
import { MarketingPromotionsService } from './marketing-promotions.service';
import { MarketingRechargesService } from './marketing-recharges.service';
import { MarketingService } from './marketing.service';
import { MarketingSharedService } from './marketing-shared.service';

@Module({
  imports: [PrismaModule, AccessControlModule, PlatformMembershipModule],
  controllers: [MarketingController],
  providers: [
    MarketingService,
    MarketingAccessService,
    MarketingSharedService,
    MarketingOverviewService,
    MarketingCustomersService,
    MarketingRechargesService,
    MarketingPointsRecordsService,
    MarketingConsumptionsService,
    MarketingPromotionsService,
  ],
})
export class MarketingModule {}
