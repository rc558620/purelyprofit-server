import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import {
  DEFAULT_PASSWORD_RESET_CODE_TTL_SECONDS,
  DEFAULT_REGISTER_CODE_TTL_SECONDS,
  DEFAULT_SMS_SEND_COOLDOWN_SECONDS,
} from './auth.constants';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthSmsModeService } from './auth-sms-mode.service';
import { AuthSmsService } from './auth-sms.service';
import type { AuthProductScope } from './auth-account.types';
import { CaptchaTokenService } from './captcha-token.service';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { SendLoginCodeResponseDto } from './dto/send-login-code-response.dto';
import { SendRegisterCodeResponseDto } from './dto/send-register-code-response.dto';
import {
  buildPasswordResetCodeKey,
  buildRegisterCodeKey,
  buildSmsSendCooldownKey,
  generateNumericCode,
} from './auth.utils';

@Injectable()
export class AuthCodeService {
  private readonly logger = new Logger(AuthCodeService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly authSmsModeService: AuthSmsModeService,
    private readonly authSmsService: AuthSmsService,
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly captchaTokenService: CaptchaTokenService,
  ) {}

  async sendRegisterCode(
    phone: string,
    productScope: AuthProductScope,
    captchaToken?: string,
  ): Promise<SendRegisterCodeResponseDto> {
    const expiresInSeconds = this.getRegisterCodeTtlSeconds();

    // 先做「必定失败」的前置校验，再消费拼图令牌：
    // 手机号已注册或处于发送冷却时，用户刚完成的拼图不应被白白烧掉，
    // 否则每次重试都要重新走一遍拼图验证。
    const existingUser = await this.authAccountLookupService.findUserByPhone(
      phone,
      productScope,
    );

    if (existingUser) {
      throw new ConflictException('手机号已被注册');
    }

    await this.ensureSmsSendCooldown('register', productScope, phone);

    // 校验并消费拼图验证令牌
    await this.captchaTokenService.validateAndConsume(captchaToken);

    // 本次发码只裁决一次通道：真实发送与「是否回传明文验证码」复用同一结论，
    // 否则两次裁决之间若模式被切换，会出现「真发了短信又回传明文码」的不一致。
    const shouldSendLive = await this.authSmsModeService.shouldSendLive(phone);

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
        shouldSendLive,
      });
    } catch (error) {
      await this.redisService.del(registerCodeKey);
      throw error;
    }

    const response: SendRegisterCodeResponseDto = {
      message: '验证码已发送，请注意查收',
      expiresInSeconds,
    };

    if (this.isExposeCodeEnabled(shouldSendLive)) {
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

    await this.ensureSmsSendCooldown('login', productScope, phone);

    const shouldSendLive = await this.authSmsModeService.shouldSendLive(phone);

    const loginCode = generateNumericCode();
    const registerCodeKey = buildRegisterCodeKey(productScope, phone);
    await this.redisService.set(registerCodeKey, loginCode, expiresInSeconds);

    try {
      await this.authSmsService.sendLoginCode({
        phone,
        code: loginCode,
        expiresInSeconds,
        shouldSendLive,
      });
    } catch (error) {
      await this.redisService.del(registerCodeKey);
      throw error;
    }

    if (this.isExposeCodeEnabled(shouldSendLive)) {
      return {
        ...response,
        code: loginCode,
      };
    }

    return response;
  }

  /**
   * purely-club 登录即注册验证码
   *
   * 与 sendLoginCode 不同的是：
   *  - 无论手机号是否已注册，都发送验证码
   *  - 发送成功统一返回通用文案，不暴露注册状态
   *  - 后续由 loginByCodeOrRegister 决定是登录还是自动注册
   *
   * @param phone 手机号
   * @param captchaToken 前端拼图验证令牌（校验通过后才允许发送短信）
   */
  async sendClubLoginOrRegisterCode(
    phone: string,
    captchaToken?: string,
  ): Promise<SendLoginCodeResponseDto> {
    // 校验并消费拼图验证令牌
    await this.captchaTokenService.validateAndConsume(captchaToken);

    const expiresInSeconds = this.getRegisterCodeTtlSeconds();
    await this.ensureSmsSendCooldown('login_or_register', 'purely_club', phone);

    const shouldSendLive = await this.authSmsModeService.shouldSendLive(phone);

    const code = generateNumericCode();
    const codeKey = buildRegisterCodeKey('purely_club', phone);

    await this.redisService.set(codeKey, code, expiresInSeconds);

    try {
      await this.authSmsService.sendLoginCode({
        phone,
        code,
        expiresInSeconds,
        shouldSendLive,
      });
    } catch (error) {
      await this.redisService.del(codeKey);
      throw error;
    }

    const response: SendLoginCodeResponseDto = {
      message: '验证码已发送，请注意查收',
      expiresInSeconds,
    };

    if (this.isExposeCodeEnabled(shouldSendLive)) {
      return { ...response, code };
    }

    return response;
  }

  /**
   * purely-club 绑定手机号验证码
   *
   * 与 sendClubLoginOrRegisterCode 类似，无论手机号是否已注册都发送验证码。
   * 后续由 bindPhone 验证码校验（ensureRegisterCodeValid）完成绑定。
   *
   * @param phone 手机号
   * @param captchaToken 前端拼图验证令牌（校验通过后才允许发送短信）
   */
  async sendBindPhoneCode(
    phone: string,
    captchaToken?: string,
  ): Promise<SendLoginCodeResponseDto> {
    // 校验并消费拼图验证令牌
    await this.captchaTokenService.validateAndConsume(captchaToken);

    const expiresInSeconds = this.getRegisterCodeTtlSeconds();
    await this.ensureSmsSendCooldown('bind_phone', 'purely_club', phone);

    const shouldSendLive = await this.authSmsModeService.shouldSendLive(phone);

    const code = generateNumericCode();
    const codeKey = buildRegisterCodeKey('purely_club', phone);

    await this.redisService.set(codeKey, code, expiresInSeconds);

    try {
      await this.authSmsService.sendLoginCode({
        phone,
        code,
        expiresInSeconds,
        shouldSendLive,
      });
    } catch (error) {
      await this.redisService.del(codeKey);
      throw error;
    }

    const response: SendLoginCodeResponseDto = {
      message: '验证码已发送，请注意查收',
      expiresInSeconds,
    };

    if (this.isExposeCodeEnabled(shouldSendLive)) {
      return { ...response, code };
    }

    return response;
  }

  async sendPasswordResetCode(
    phone: string,
    productScope: AuthProductScope,
    captchaToken?: string,
  ): Promise<ForgotPasswordResponseDto> {
    // 校验并消费拼图验证令牌
    await this.captchaTokenService.validateAndConsume(captchaToken);

    const expiresInSeconds = this.getPasswordResetCodeTtlSeconds();
    const user = await this.authAccountLookupService.findUserByPhone(
      phone,
      productScope,
    );

    if (!user) {
      // 无论是否已注册都返回 200，避免通过 HTTP 状态码差异枚举手机号
      return {
        message: '如果该手机号已注册，重置验证码短信已发送，请注意查收',
        expiresInSeconds,
      } as ForgotPasswordResponseDto;
    }

    const response: ForgotPasswordResponseDto = {
      message: '重置验证码短信已发送，请注意查收',
      expiresInSeconds,
    };

    await this.ensureSmsSendCooldown('password-reset', productScope, phone);

    const shouldSendLive = await this.authSmsModeService.shouldSendLive(phone);

    const resetCode = generateNumericCode();
    const resetCodeKey = buildPasswordResetCodeKey(productScope, phone);
    await this.redisService.set(resetCodeKey, resetCode, expiresInSeconds);

    try {
      await this.authSmsService.sendPasswordResetCode({
        phone,
        code: resetCode,
        expiresInSeconds,
        shouldSendLive,
      });
    } catch (error) {
      await this.redisService.del(resetCodeKey);
      throw error;
    }

    if (this.isExposeCodeEnabled(shouldSendLive)) {
      return {
        ...response,
        resetCode,
      };
    }

    return response;
  }

  private async ensureSmsSendCooldown(
    scene:
      | 'register'
      | 'login'
      | 'password-reset'
      | 'login_or_register'
      | 'bind_phone',
    productScope: AuthProductScope,
    phone: string,
  ): Promise<void> {
    const cooldownSeconds = this.getSmsSendCooldownSeconds();
    if (cooldownSeconds <= 0) {
      return;
    }

    const cooldownKey = buildSmsSendCooldownKey(scene, productScope, phone);
    const acquired = await this.redisService.setIfAbsent(
      cooldownKey,
      '1',
      cooldownSeconds,
    );
    if (!acquired) {
      throw new HttpException(
        `短信发送过于频繁，请 ${cooldownSeconds} 秒后再试`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
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

  private getSmsSendCooldownSeconds(): number {
    return (
      this.configService.get<number>('auth.smsSendCooldownSeconds') ??
      DEFAULT_SMS_SEND_COOLDOWN_SECONDS
    );
  }

  /**
   * 是否在响应中暴露验证码明文。
   *
   * 需同时满足两个条件：
   * 1. 显式配置开关 `auth.exposeCodeInResponse` 为 true（默认关闭，生产禁止启用）；
   * 2. 本次未真实发送短信 —— 真实发送时必须禁止暴露明文验证码，
   *    否则前端可直接拿到验证码，等同于绕过短信校验直接改密。
   * @param shouldSendLive 本次发码的真实发送裁决结果
   */
  private isExposeCodeEnabled(shouldSendLive: boolean): boolean {
    if (this.configService.get<boolean>('auth.exposeCodeInResponse') !== true) {
      return false;
    }
    return !shouldSendLive;
  }
}
