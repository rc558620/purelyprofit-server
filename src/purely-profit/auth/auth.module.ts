import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PlatformMembershipModule } from '../member/platform-membership/platform-membership.module';
import { AuthAccountService } from './auth-account.service';
import { AuthAuthenticationService } from './auth-authentication.service';
import { AuthCapabilityService } from './auth-capability.service';
import { AuthCodeService } from './auth-code.service';
import { AuthController } from './auth.controller';
import { AuthPasswordService } from './auth-password.service';
import { AuthProfileService } from './auth-profile.service';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { AuthSmsService } from './auth-sms.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
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
    AuthAuthenticationService,
    AuthCapabilityService,
    AuthCodeService,
    AuthPasswordService,
    AuthProfileService,
    AuthSessionService,
    AuthSmsService,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
