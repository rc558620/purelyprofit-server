import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubOrdersModule } from '../orders/club-orders.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubRechargeController } from './club-recharge.controller';
import { ClubRechargeContextService } from './club-recharge-context.service';
import { ClubRechargeCreationService } from './club-recharge-creation.service';
import { ClubRechargePackagesService } from './club-recharge-packages.service';
import { ClubRechargePaymentService } from './club-recharge-payment.service';
import { ClubRechargeQueryService } from './club-recharge-query.service';
import { ClubRechargeService } from './club-recharge.service';
import { ClubRechargeSettlementService } from './club-recharge-settlement.service';

@Module({
  imports: [AuthModule, PrismaModule, ClubStoresModule, ClubOrdersModule],
  controllers: [ClubRechargeController],
  providers: [
    ClubRechargeContextService,
    ClubRechargeCreationService,
    ClubRechargePackagesService,
    ClubRechargePaymentService,
    ClubRechargeQueryService,
    ClubRechargeSettlementService,
    ClubRechargeService,
  ],
  exports: [ClubRechargePaymentService, ClubRechargeService],
})
export class ClubRechargeModule {}
