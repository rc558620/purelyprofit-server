import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RedisModule } from '../../../redis/redis.module';
import { SalesRecordModule } from '../sales-record/sales-record.module';
import { SpaceDashboardService } from './space-dashboard.service';
import { SpaceReservationsController } from './space-reservations.controller';
import { SpaceReservationsService } from './space-reservations.service';
import { SpaceSessionCheckoutLockService } from './space-session-checkout-lock.service';
import { SpaceSessionCheckoutService } from './space-session-checkout.service';
import { SpaceSessionOpenService } from './space-session-open.service';
import { SpaceSessionReadService } from './space-session-read.service';
import { SpaceSessionRenewService } from './space-session-renew.service';
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
    SalesRecordModule,
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
    SpaceTypesService,
    SpaceZonesService,
    SpaceReservationsService,
    SpaceSessionCheckoutLockService,
    SpaceSessionCheckoutService,
    SpaceSessionOpenService,
    SpaceSessionReadService,
    SpaceSessionRenewService,
    SpaceSessionSettlementService,
    SpaceSessionTransferService,
    SpaceSessionWriteService,
    SpaceSessionsService,
    SpaceDashboardService,
  ],
  exports: [SpaceSessionSettlementService],
})
export class SpacesModule {}
