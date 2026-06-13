import { Module } from '@nestjs/common';
import { StoresModule } from '../../purely-profit/stores/stores.module';
import { ClubWechatJsapiService } from './club-wechat-jsapi.service';

/**
 * ClubWechatPayModule
 *
 * 独立的微信支付功能模块，不依赖 ClubOrdersModule / ClubRechargeModule，
 * 避免循环依赖。
 *
 * 导出 ClubWechatJsapiService 供下单模块使用。
 */
@Module({
  imports: [StoresModule],
  providers: [ClubWechatJsapiService],
  exports: [ClubWechatJsapiService],
})
export class ClubWechatPayModule {}
