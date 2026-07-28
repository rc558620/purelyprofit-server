import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { CommerceModule } from '../../purely-profit/commerce/commerce.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubServiceCallController } from './club-service-call.controller';
import { ClubServiceCallService } from './club-service-call.service';
import { ServiceCallGateway } from './service-call.gateway';
import { ServiceCallRealtimeService } from './service-call-realtime.service';

@Module({
  imports: [
    AuthModule,
    CommerceModule,
    PrismaModule,
    RedisModule,
    ClubStoresModule,
  ],
  controllers: [ClubServiceCallController],
  providers: [
    ClubServiceCallService,
    ServiceCallRealtimeService,
    ServiceCallGateway,
  ],
  exports: [ClubServiceCallService, ServiceCallRealtimeService],
})
export class ClubServiceCallModule {}
