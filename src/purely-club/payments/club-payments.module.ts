import { Module } from '@nestjs/common';
import { ClubOrdersModule } from '../orders/club-orders.module';
import { ClubRechargeModule } from '../recharge/club-recharge.module';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';
import { ClubPaymentsController } from './club-payments.controller';
import { ClubPaymentsService } from './club-payments.service';

@Module({
  imports: [ClubRechargeModule, ClubOrdersModule],
  controllers: [ClubPaymentsController],
  providers: [
    ClubPaymentCallbackSignatureService,
    ClubPaymentCallbackDispatchService,
    ClubPaymentsService,
  ],
})
export class ClubPaymentsModule {}
