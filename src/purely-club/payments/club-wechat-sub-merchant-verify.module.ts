import { Module } from '@nestjs/common';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import { ClubWechatSubMerchantVerifyService } from './club-wechat-sub-merchant-verify.service';

/**
 * 子商户绑定校验模块。
 *
 * ⚠️ 为什么独立成模块而不是并入 ClubWechatPayModule：商家端保存/校验收款配置的
 * 接口在 StoresModule（purely-profit 侧），而 ClubWechatPayModule **依赖**
 * StoresModule 读取门店收款配置。若让 StoresModule 反过来 import 它就会成环。
 * 因此这里只装配「不依赖 StoresModule」的最小依赖，专供 StoresModule 引入。
 *
 * 说明：本模块单独提供一个 ClubWechatPayHttpService 实例（与支付链路的那个不共享），
 * 该服务除了一份 5 分钟过期的私钥缓存外不持有任何状态，重复实例化是安全的。
 */
@Module({
  providers: [ClubWechatPayHttpService, ClubWechatSubMerchantVerifyService],
  exports: [ClubWechatSubMerchantVerifyService],
})
export class ClubWechatSubMerchantVerifyModule {}
