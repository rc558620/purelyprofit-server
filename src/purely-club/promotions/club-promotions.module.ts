import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubPromotionsController } from './club-promotions.controller';
import { ClubPromotionsService } from './club-promotions.service';

@Module({
  imports: [AuthModule, PrismaModule, RedisModule, ClubStoresModule],
  controllers: [ClubPromotionsController],
  providers: [ClubPromotionsService],
  exports: [ClubPromotionsService],
})
export class ClubPromotionsModule {}
