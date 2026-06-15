import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { ClubAuthController } from './club-auth.controller';
import { ClubAuthService } from './club-auth.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [ClubAuthController],
  providers: [ClubAuthService, ClubWechatAuthService],
})
export class ClubAuthModule {}
