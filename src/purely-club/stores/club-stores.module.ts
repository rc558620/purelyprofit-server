import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { StoresProfileService } from '../../purely-profit/stores/stores-profile.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { ClubStoresController } from './club-stores.controller';
import { ClubStoresService } from './club-stores.service';

@Module({
  imports: [AuthModule, PrismaModule, RedisModule],
  controllers: [ClubStoresController],
  providers: [ClubStoresService, StoresProfileService],
  exports: [ClubStoresService],
})
export class ClubStoresModule {}
