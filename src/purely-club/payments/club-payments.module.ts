import { Module } from '@nestjs/common';
import { ClubOrdersModule } from '../orders/club-orders.module';
import { ClubRechargeModule } from '../recharge/club-recharge.module';
import { ClubPaymentsController } from './club-payments.controller';
import { ClubPaymentsService } from './club-payments.service';

@Module({
  imports: [ClubRechargeModule, ClubOrdersModule],
  controllers: [ClubPaymentsController],
  providers: [ClubPaymentsService],
})
export class ClubPaymentsModule {}
