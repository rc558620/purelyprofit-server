import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubAccountMergeService } from './club-account-merge.service';
import { ClubAuthController } from './club-auth.controller';
import { ClubAuthService } from './club-auth.service';
import { ClubPhoneBindService } from './club-phone-bind.service';
import { ClubPhoneRebindService } from './club-phone-rebind.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';

@Module({
  // ClubStoresModule 提供 ClubStoreAccessService：换绑手机号后需要清
  // 「可访问门店」缓存。该模块不反向依赖本模块，无循环依赖。
  imports: [AuthModule, ClubStoresModule],
  controllers: [ClubAuthController],
  providers: [
    ClubAuthService,
    ClubWechatAuthService,
    ClubPhoneBindService,
    ClubPhoneRebindService,
    ClubAccountMergeService,
  ],
})
export class ClubAuthModule {}
