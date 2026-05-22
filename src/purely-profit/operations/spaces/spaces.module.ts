import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RedisModule } from '../../../redis/redis.module';
import { SalesRecordModule } from '../sales-record/sales-record.module';
import { SpaceDashboardService } from './space-dashboard.service';
import { SpaceReservationsController } from './space-reservations.controller';
import { SpaceReservationsService } from './space-reservations.service';
import { SpaceSessionsController } from './space-sessions.controller';
import { SpaceSessionsService } from './space-sessions.service';
import { SpaceTypesController } from './space-types.controller';
import { SpaceTypesService } from './space-types.service';
import { SpaceZonesController } from './space-zones.controller';
import { SpaceZonesService } from './space-zones.service';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';

@Module({
  imports: [PrismaModule, CommerceModule, SalesRecordModule, RedisModule],
  controllers: [
    SpaceTypesController,
    SpaceZonesController,
    SpacesController,
    SpaceReservationsController,
    SpaceSessionsController,
  ],
  providers: [
    SpacesService,
    SpaceTypesService,
    SpaceZonesService,
    SpaceReservationsService,
    SpaceSessionsService,
    SpaceDashboardService,
  ],
})
export class SpacesModule {}
