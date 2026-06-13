import { Module } from '@nestjs/common';
import { ClubMemberLevelsService } from '../../purely-club/member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../../purely-club/member/member-profile/club-member-profile.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { PlatformMembershipModule } from '../member/platform-membership/platform-membership.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { MarketingAccessService } from './marketing-access.service';
import {
  MarketingController,
  MarketingCustomersController,
  MarketingProductCategoriesController,
  MarketingProductsController,
  MarketingPromotionsController,
  MarketingTransactionsController,
} from './marketing.controller';
import { MarketingOverviewController } from './marketing-overview.controller';
import { MarketingConsumptionsService } from './marketing-consumptions.service';
import { MarketingCustomersService } from './marketing-customers.service';
import { MarketingOverviewService } from './marketing-overview.service';
import { MarketingPointsRecordsService } from './marketing-points-records.service';
import { MarketingProductCategoriesService } from './marketing-product-categories.service';
import { MarketingProductsService } from './marketing-products.service';
import { MarketingPromotionsService } from './marketing-promotions.service';
import { MarketingRechargesService } from './marketing-recharges.service';
import {
  MarketingCustomersFacadeService,
  MarketingOverviewFacadeService,
  MarketingProductsFacadeService,
  MarketingPromotionsFacadeService,
  MarketingService,
  MarketingTransactionsFacadeService,
} from './marketing.service';
import { MarketingSharedService } from './marketing-shared.service';

@Module({
  imports: [PrismaModule, AccessControlModule, PlatformMembershipModule],
  controllers: [
    MarketingController,
    MarketingOverviewController,
    MarketingCustomersController,
    MarketingTransactionsController,
    MarketingProductCategoriesController,
    MarketingProductsController,
    MarketingPromotionsController,
  ],
  providers: [
    MarketingService,
    MarketingOverviewFacadeService,
    MarketingCustomersFacadeService,
    MarketingTransactionsFacadeService,
    MarketingPromotionsFacadeService,
    MarketingProductsFacadeService,
    MarketingAccessService,
    MarketingSharedService,
    MarketingOverviewService,
    MarketingCustomersService,
    MarketingRechargesService,
    MarketingPointsRecordsService,
    MarketingConsumptionsService,
    MarketingPromotionsService,
    MarketingProductCategoriesService,
    MarketingProductsService,
    ClubMemberProfileService,
    ClubMemberLevelsService,
  ],
  exports: [MarketingOverviewService],
})
export class MarketingModule {}
