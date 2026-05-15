import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SalesRecordModule } from '../sales-record/sales-record.module';
import { SpaceReservationsController } from './space-reservations.controller';
import { SpaceSessionsController } from './space-sessions.controller';
import { SpaceTypesController } from './space-types.controller';
import { SpaceZonesController } from './space-zones.controller';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';

@Module({
  imports: [PrismaModule, CommerceModule, SalesRecordModule],
  controllers: [
    SpaceTypesController,
    SpaceZonesController,
    SpacesController,
    SpaceReservationsController,
    SpaceSessionsController,
  ],
  providers: [SpacesService],
})
export class SpacesModule {}
