import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubOrdersModule } from '../orders/club-orders.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubRechargeController } from './club-recharge.controller';
import { ClubRechargeService } from './club-recharge.service';
import { ClubRechargePackagesService } from './club-recharge-packages.service';

@Module({
  imports: [AuthModule, PrismaModule, ClubStoresModule, ClubOrdersModule],
  controllers: [ClubRechargeController],
  providers: [ClubRechargeService, ClubRechargePackagesService],
  exports: [ClubRechargeService, ClubRechargePackagesService],
})
export class ClubRechargeModule {}
