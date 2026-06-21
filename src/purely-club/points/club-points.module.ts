import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubPointsQueryService } from './club-points-query.service';
import { ClubPointsService } from './club-points.service';
import { ClubPointsController } from './club-points.controller';

@Module({
  imports: [forwardRef(() => AuthModule), PrismaModule, ClubStoresModule],
  controllers: [ClubPointsController],
  providers: [ClubPointsQueryService, ClubPointsService],
})
export class ClubPointsModule {}
