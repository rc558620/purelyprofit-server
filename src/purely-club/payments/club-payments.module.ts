import { Module } from '@nestjs/common';
import { StoresModule } from '../../purely-profit/stores/stores.module';
import { ClubOrdersModule } from '../orders/club-orders.module';
import { ClubRechargeModule } from '../recharge/club-recharge.module';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';
import { ClubPaymentsController } from './club-payments.controller';
import { ClubPaymentsService } from './club-payments.service';
import { ClubWechatCallbackDecryptorService } from './club-wechat-callback-decryptor.service';

@Module({
  imports: [ClubRechargeModule, ClubOrdersModule, StoresModule],
  controllers: [ClubPaymentsController],
  providers: [
    ClubPaymentCallbackSignatureService,
    ClubPaymentCallbackDispatchService,
    ClubWechatCallbackDecryptorService,
    ClubPaymentsService,
  ],
})
export class ClubPaymentsModule {}
