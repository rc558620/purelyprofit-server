import { Module } from '@nestjs/common';
import { ClubMemberLevelsService } from '../../purely-club/member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../../purely-club/member/member-profile/club-member-profile.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { PlatformMembershipModule } from '../member/platform-membership/platform-membership.module';
import { StoresModule } from '../stores/stores.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { MarketingAccessService } from './marketing-access.service';
import {
  MarketingCustomersController,
  MarketingOverviewController,
  MarketingProductCategoriesController,
  MarketingProductsController,
  MarketingPromotionsController,
  MarketingTransactionsController,
} from './marketing.controller';
import { MarketingConsumptionsService } from './marketing-consumptions.service';
import { MarketingCustomerListService } from './marketing-customer-list.service';
import { MarketingCustomerPointsService } from './marketing-customer-points.service';
import { MarketingCustomersService } from './marketing-customers.service';
import { MarketingMemberLevelSettingsService } from './marketing-member-level-settings.service';
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
  imports: [
    PrismaModule,
    AccessControlModule,
    PlatformMembershipModule,
    StoresModule,
  ],
  controllers: [
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
    MarketingMemberLevelSettingsService,
    MarketingOverviewService,
    MarketingCustomersService,
    MarketingCustomerListService,
    MarketingCustomerPointsService,
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
