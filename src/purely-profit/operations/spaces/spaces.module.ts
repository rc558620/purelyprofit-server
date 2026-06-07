import { Module, forwardRef } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RedisModule } from '../../../redis/redis.module';
import { SalesRecordModule } from '../sales-record/sales-record.module';
import { SpaceAutoCheckoutSchedulerService } from './space-auto-checkout-scheduler.service';
import { SpaceSessionAutoCheckoutService } from './space-session-auto-checkout.service';
import { SpaceDashboardService } from './space-dashboard.service';
import { SpaceReservationsController } from './space-reservations.controller';
import { SpacesRefResolverService } from './spaces-ref-resolver.service';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { SpaceReservationsService } from './space-reservations.service';
import { SpaceSessionCheckoutLockService } from './space-session-checkout-lock.service';
import { SpaceSessionCheckoutService } from './space-session-checkout.service';
import { SpaceSessionOpenService } from './space-session-open.service';
import { SpaceSessionReadService } from './space-session-read.service';
import { SpaceSessionReadStateService } from './space-session-read-state.service';
import { SpaceSessionRenewService } from './space-session-renew.service';
import { SpaceDashboardSummaryService } from './space-dashboard-summary.service';
import { SpaceSessionSettlementService } from './space-session-settlement.service';
import { SpaceSessionTransferService } from './space-session-transfer.service';
import { SpaceSessionWriteService } from './space-session-write.service';
import { SpaceSessionsController } from './space-sessions.controller';
import { SpaceSessionsService } from './space-sessions.service';
import { SpaceTypesController } from './space-types.controller';
import { SpaceTypesService } from './space-types.service';
import { SpaceZonesController } from './space-zones.controller';
import { SpaceZonesService } from './space-zones.service';
import { SpacesController } from './spaces.controller';
import { SpacesReadService } from './spaces-read.service';
import { SpacesService } from './spaces.service';
import { SpacesWriteService } from './spaces-write.service';

@Module({
  imports: [
    PrismaModule,
    CommerceModule,
    PlatformMembershipModule,
    forwardRef(() => SalesRecordModule),
    RedisModule,
  ],
  controllers: [
    SpaceTypesController,
    SpaceZonesController,
    SpacesController,
    SpaceReservationsController,
    SpaceSessionsController,
  ],
  providers: [
    SpacesService,
    SpacesReadService,
    SpacesWriteService,
    SpacesRefResolverService,
    SpaceTypesService,
    SpaceZonesService,
    SpaceReservationsStateService,
    SpaceReservationsService,
    SpaceSessionCheckoutLockService,
    SpaceSessionCheckoutService,
    SpaceSessionAutoCheckoutService,
    SpaceSessionOpenService,
    SpaceSessionReadService,
    SpaceSessionReadStateService,
    SpaceSessionRenewService,
    SpaceDashboardSummaryService,
    SpaceSessionSettlementService,
    SpaceSessionTransferService,
    SpaceSessionWriteService,
    SpaceSessionsService,
    SpaceDashboardService,
    SpaceAutoCheckoutSchedulerService,
  ],
  exports: [SpaceSessionSettlementService, SpaceSessionAutoCheckoutService],
})
export class SpacesModule {}
