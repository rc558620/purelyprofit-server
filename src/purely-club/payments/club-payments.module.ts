import { Module } from '@nestjs/common';
import { RedisModule } from '../../redis/redis.module';
import { StoresModule } from '../../purely-profit/stores/stores.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubScanOrderingModule } from '../scan-ordering/club-scan-ordering.module';
import { ClubScanOrderingPaymentService } from '../scan-ordering/club-scan-ordering-payment.service';
import { ClubOrdersModule } from '../orders/club-orders.module';
import { ClubVoucherOrdersModule } from '../voucher-orders/club-voucher-orders.module';
import { ClubRechargeModule } from '../recharge/club-recharge.module';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';
import { ClubPaymentLockService } from './club-payment-lock.service';
import { ClubPaymentsController } from './club-payments.controller';
import { ClubPaymentsService } from './club-payments.service';
import { ClubWechatCallbackDecryptorService } from './club-wechat-callback-decryptor.service';

@Module({
  imports: [
    ClubRechargeModule,
    ClubOrdersModule,
    ClubVoucherOrdersModule,
    RedisModule,
    StoresModule,
    PrismaModule,
    ClubScanOrderingModule,
  ],
  controllers: [ClubPaymentsController],
  providers: [
    ClubPaymentCallbackSignatureService,
    ClubPaymentCallbackDispatchService,
    ClubPaymentLockService,
    ClubWechatCallbackDecryptorService,
    ClubScanOrderingPaymentService,
    ClubPaymentsService,
  ],
  exports: [ClubPaymentLockService],
})
export class ClubPaymentsModule {}
