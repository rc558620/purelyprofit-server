import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { ClubPointsQueryService } from '../points/club-points-query.service';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubCheckInCacheService } from './club-check-in.cache.service';
import { ClubCheckInController } from './club-check-in.controller';
import { ClubCheckInQueryService } from './club-check-in.query.service';
import { ClubCheckInService } from './club-check-in.service';
import { ClubCheckInStatusService } from './club-check-in.status.service';

@Module({
  imports: [AuthModule, PrismaModule, RedisModule, ClubStoresModule],
  controllers: [ClubCheckInController],
  providers: [
    ClubPointsQueryService,
    ClubCheckInCacheService,
    ClubCheckInQueryService,
    ClubCheckInStatusService,
    ClubCheckInService,
  ],
})
export class ClubCheckInModule {}
