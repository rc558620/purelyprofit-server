import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { StoresController } from './stores.controller';
import { StoresProfileService } from './stores-profile.service';
import { StoresReadService } from './stores-read.service';
import { StoresService } from './stores.service';
import { StoresWechatPayService } from './stores-wechat-pay.service';
import { StoresWriteService } from './stores-write.service';
import { WechatPayEncryptionService } from './wechat-pay-encryption.service';

@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [StoresController],
  providers: [
    StoresService,
    StoresProfileService,
    StoresReadService,
    StoresWriteService,
    StoresWechatPayService,
    WechatPayEncryptionService,
  ],
  exports: [StoresProfileService, StoresWechatPayService],
})
export class StoresModule {}
