import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { ClubOrdersController } from './club-orders.controller';
import { ClubOrdersService } from './club-orders.service';

@Module({
  imports: [AuthModule, PrismaModule, RedisModule, ClubStoresModule],
  controllers: [ClubOrdersController],
  providers: [ClubOrderDraftsService, ClubOrdersService],
  exports: [ClubOrderDraftsService, ClubOrdersService],
})
export class ClubOrdersModule {}
