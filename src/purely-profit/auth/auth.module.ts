import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { RedisModule } from '../../redis/redis.module';
import { PlatformMembershipModule } from '../member/platform-membership/platform-membership.module';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthAccountMembershipService } from './auth-account-membership.service';
import { AuthAccountService } from './auth-account.service';
import { AuthAuthenticationService } from './auth-authentication.service';
import { AuthCapabilityService } from './auth-capability.service';
import { AuthCodeService } from './auth-code.service';
import { AuthController } from './auth.controller';
import { AuthPasswordService } from './auth-password.service';
import { AuthProfileService } from './auth-profile.service';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { AuthSmsService } from './auth-sms.service';
import { AuthRegisterStoreService } from './auth-register-store.service';
import { AuthRsaService } from './auth-rsa.service';
import {
  ClubJwtAuthGuard,
  JwtAuthGuard,
  PulseJwtAuthGuard,
} from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    forwardRef(() => RedisModule),
    forwardRef(() => PlatformMembershipModule),
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
    AuthAccountMembershipService,
    AuthAuthenticationService,
    AuthCapabilityService,
    AuthCodeService,
    AuthPasswordService,
    AuthProductAuthService,
    AuthProfileService,
    AuthSessionService,
    AuthSmsService,
    AuthRegisterStoreService,
    AuthRsaService,
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
    AuthSessionService,
    JwtAuthGuard,
    ClubJwtAuthGuard,
    PulseJwtAuthGuard,
    JwtModule,
    AuthRsaService,
  ],
})
export class AuthModule {}
