import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ClubWechatSubMerchantVerifyModule } from '../../purely-club/payments/club-wechat-sub-merchant-verify.module';
import { StoresController } from './stores.controller';
import { StoresProfileService } from './stores-profile.service';
import { StoreLogoProxyService } from './store-logo-proxy.service';
import { StoresReadService } from './stores-read.service';
import { StoresService } from './stores.service';
import { StoreBusinessCapabilityModule } from './store-business-capability.module';
import { StoresWechatPayBindService } from './stores-wechat-pay-bind.service';
import { StoresWechatPayService } from './stores-wechat-pay.service';
import { StoresWriteService } from './stores-write.service';
import { WechatPayEncryptionService } from './wechat-pay-encryption.service';

@Module({
  imports: [
    AuthModule,
    SubscriptionsModule,
    StoreBusinessCapabilityModule,
    // 子商户绑定校验（服务商模式）。刻意引入独立的轻量模块而非 ClubWechatPayModule：
    // 后者依赖 StoresModule，反向 import 会成环，详见该模块注释。
    ClubWechatSubMerchantVerifyModule,
  ],
  controllers: [StoresController],
  providers: [
    StoresService,
    StoresProfileService,
    StoresReadService,
    StoresWriteService,
    StoresWechatPayService,
    StoresWechatPayBindService,
    StoreLogoProxyService,
    WechatPayEncryptionService,
  ],
  exports: [
    StoresProfileService,
    StoresWechatPayService,
    StoreBusinessCapabilityModule,
  ],
})
export class StoresModule {}
