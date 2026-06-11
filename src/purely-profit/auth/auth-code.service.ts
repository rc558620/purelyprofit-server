import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import {
  DEFAULT_PASSWORD_RESET_CODE_TTL_SECONDS,
  DEFAULT_REGISTER_CODE_TTL_SECONDS,
} from './auth.constants';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthSmsService } from './auth-sms.service';
import type { AuthProductScope } from './auth-account.types';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { SendLoginCodeResponseDto } from './dto/send-login-code-response.dto';
import { SendRegisterCodeResponseDto } from './dto/send-register-code-response.dto';
import {
  buildPasswordResetCodeKey,
  buildRegisterCodeKey,
  generateNumericCode,
} from './auth.utils';

@Injectable()
export class AuthCodeService {
  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly authSmsService: AuthSmsService,
    private readonly authAccountLookupService: AuthAccountLookupService,
  ) {}

  async sendRegisterCode(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<SendRegisterCodeResponseDto> {
    const expiresInSeconds = this.getRegisterCodeTtlSeconds();
    const existingUser = await this.authAccountLookupService.findUserByPhone(
      phone,
      productScope,
    );

    if (existingUser) {
      throw new ConflictException('手机号已被注册');
    }

    const registerCode = generateNumericCode();
    const registerCodeKey = buildRegisterCodeKey(productScope, phone);
    await this.redisService.set(
      registerCodeKey,
      registerCode,
      expiresInSeconds,
    );

    try {
      await this.authSmsService.sendRegisterCode({
        phone,
        code: registerCode,
        expiresInSeconds,
      });
    } catch (error) {
      await this.redisService.del(registerCodeKey);
      throw error;
    }

    const response: SendRegisterCodeResponseDto = {
      message: '验证码已发送，请注意查收',
      expiresInSeconds,
    };

    if (this.isNonProductionEnv()) {
      return {
        ...response,
        code: registerCode,
      };
    }

    return response;
  }

  async sendLoginCode(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<SendLoginCodeResponseDto> {
    const expiresInSeconds = this.getRegisterCodeTtlSeconds();
    const response: SendLoginCodeResponseDto = {
      message: '如手机号已注册，登录验证码短信已发送，请注意查收',
      expiresInSeconds,
    };
    const user = await this.authAccountLookupService.findUserByPhone(
      phone,
      productScope,
    );

    if (!user) {
      return response;
    }

    const loginCode = generateNumericCode();
    const registerCodeKey = buildRegisterCodeKey(productScope, phone);
    await this.redisService.set(registerCodeKey, loginCode, expiresInSeconds);

    try {
      await this.authSmsService.sendLoginCode({
        phone,
        code: loginCode,
        expiresInSeconds,
      });
    } catch (error) {
      await this.redisService.del(registerCodeKey);
      throw error;
    }

    if (this.isNonProductionEnv()) {
      return {
        ...response,
        code: loginCode,
      };
    }

    return response;
  }

  async ensureRegisterCodeValid(
    phone: string,
    code: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    const cachedCode = await this.redisService.get(
      buildRegisterCodeKey(productScope, phone),
    );
    if (!cachedCode || cachedCode !== code) {
      throw new UnauthorizedException('验证码无效或已过期');
    }
  }

  async clearRegisterCode(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    await this.redisService.del(buildRegisterCodeKey(productScope, phone));
  }

  async sendPasswordResetCode(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<ForgotPasswordResponseDto> {
    const expiresInSeconds = this.getPasswordResetCodeTtlSeconds();
    const response: ForgotPasswordResponseDto = {
      message: '如手机号已注册，重置验证码短信已发送，请注意查收',
      expiresInSeconds,
    };
    const user = await this.authAccountLookupService.findUserByPhone(
      phone,
      productScope,
    );

    if (!user) {
      return response;
    }

    const resetCode = generateNumericCode();
    const resetCodeKey = buildPasswordResetCodeKey(productScope, phone);
    await this.redisService.set(resetCodeKey, resetCode, expiresInSeconds);

    try {
      await this.authSmsService.sendPasswordResetCode({
        phone,
        code: resetCode,
        expiresInSeconds,
      });
    } catch (error) {
      await this.redisService.del(resetCodeKey);
      throw error;
    }

    if (this.isNonProductionEnv()) {
      return {
        ...response,
        resetCode,
      };
    }

    return response;
  }

  async ensurePasswordResetCodeValid(
    phone: string,
    code: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    const cachedCode = await this.redisService.get(
      buildPasswordResetCodeKey(productScope, phone),
    );
    if (!cachedCode || cachedCode !== code) {
      throw new UnauthorizedException('验证码无效或已过期');
    }
  }

  async clearPasswordResetCode(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    await this.redisService.del(buildPasswordResetCodeKey(productScope, phone));
  }

  private getPasswordResetCodeTtlSeconds(): number {
    return (
      this.configService.get<number>('auth.passwordResetCodeTtlSeconds') ??
      DEFAULT_PASSWORD_RESET_CODE_TTL_SECONDS
    );
  }

  private getRegisterCodeTtlSeconds(): number {
    return (
      this.configService.get<number>('auth.registerCodeTtlSeconds') ??
      DEFAULT_REGISTER_CODE_TTL_SECONDS
    );
  }

  private isNonProductionEnv(): boolean {
    return this.configService.get<string>('nodeEnv') !== 'production';
  }
}
