import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PlatformMembershipAccessModule } from '../member/platform-membership/platform-membership-access.module';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthProfitAccountLookupService } from './auth-profit-account-lookup.service';
import { AuthBanGuardService } from './auth-ban-guard.service';
import { AuthMembershipResolverService } from './auth-membership-resolver.service';
import { AuthStaffActivationService } from './auth-staff-activation.service';
import { AuthAccountService } from './auth-account.service';
import { AuthAuthenticationService } from './auth-authentication.service';
import { AuthCapabilityService } from './auth-capability.service';
import { AuthCodeLoginService } from './auth-code-login.service';
import { AuthCodeService } from './auth-code.service';
import { AuthCodeVerifyService } from './auth-code-verify.service';
import { CaptchaTokenService } from './captcha-token.service';
import { AuthController } from './auth.controller';
import { AuthLoginFailGuardService } from './auth-login-fail-guard.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthPasswordOpsService } from './auth-password-ops.service';
import { AuthProfileService } from './auth-profile.service';
import { AuthPromoRecordService } from './auth-promo-record.service';
import { AuthWechatLoginService } from './auth-wechat-login.service';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { AuthSmsService } from './auth-sms.service';
import { AuthRegisterStoreService } from './auth-register-store.service';
import { AuthRsaService } from './auth-rsa.service';
import { StoreInviteCodeService } from '../stores/store-invite-code.service';
import {
  ClubJwtAuthGuard,
  JwtAuthGuard,
  PulseJwtAuthGuard,
} from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    PlatformMembershipAccessModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: (config.get<string>('jwt.expiresIn') ?? '7d') as
            | `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`
            | number,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthAccountService,
    AuthAccountLookupService,
    AuthProfitAccountLookupService,
    AuthBanGuardService,
    AuthMembershipResolverService,
    AuthStaffActivationService,
    AuthAuthenticationService,
    AuthCapabilityService,
    AuthCodeLoginService,
    AuthCodeService,
    AuthCodeVerifyService,
    CaptchaTokenService,
    AuthLoginFailGuardService,
    AuthPasswordService,
    AuthPasswordOpsService,
    AuthProductAuthService,
    AuthProfileService,
    AuthPromoRecordService,
    AuthSessionService,
    AuthSmsService,
    AuthWechatLoginService,
    AuthRegisterStoreService,
    AuthRsaService,
    StoreInviteCodeService,
    JwtStrategy,
    JwtAuthGuard,
    ClubJwtAuthGuard,
    PulseJwtAuthGuard,
  ],
  exports: [
    AuthService,
    AuthProductAuthService,
    AuthAccountLookupService,
    AuthCodeService,
    AuthCodeVerifyService,
    CaptchaTokenService,
    AuthSessionService,
    AuthStaffActivationService,
    JwtAuthGuard,
    ClubJwtAuthGuard,
    PulseJwtAuthGuard,
    JwtModule,
    AuthRsaService,
  ],
})
export class AuthModule {}
