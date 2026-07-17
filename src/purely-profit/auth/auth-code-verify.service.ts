import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import {
  AUTH_CODE_MAX_ATTEMPTS,
  AUTH_CODE_ATTEMPTS_LOCK_TTL_SECONDS,
} from './auth.constants';
import type { AuthProductScope } from './auth-account.types';
import {
  buildPasswordResetCodeKey,
  buildRegisterCodeKey,
  buildCodeAttemptsKey,
} from './auth.utils';

@Injectable()
export class AuthCodeVerifyService {
  private readonly logger = new Logger(AuthCodeVerifyService.name);

  constructor(private readonly redisService: RedisService) {}

  async ensureRegisterCodeValid(
    phone: string,
    code: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    // 先检查尝试次数是否已超限
    await this.ensureCodeAttemptsNotExceeded('register', productScope, phone);

    const cachedCode = await this.redisService.get(
      buildRegisterCodeKey(productScope, phone),
    );
    if (!cachedCode || cachedCode !== code) {
      // 验证失败，递增尝试次数
      await this.incrementCodeAttempts('register', productScope, phone);
      throw new UnauthorizedException('验证码无效或已过期');
    }

    // 验证成功，清除尝试次数计数
    await this.clearCodeAttempts('register', productScope, phone);
  }

  async clearRegisterCode(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    await this.redisService.del(buildRegisterCodeKey(productScope, phone));
  }

  async ensurePasswordResetCodeValid(
    phone: string,
    code: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    // 先检查尝试次数是否已超限
    await this.ensureCodeAttemptsNotExceeded(
      'password-reset',
      productScope,
      phone,
    );

    const cachedCode = await this.redisService.get(
      buildPasswordResetCodeKey(productScope, phone),
    );
    if (!cachedCode || cachedCode !== code) {
      // 验证失败，递增尝试次数
      await this.incrementCodeAttempts('password-reset', productScope, phone);
      throw new UnauthorizedException('验证码无效或已过期');
    }

    // 验证成功，清除尝试次数计数
    await this.clearCodeAttempts('password-reset', productScope, phone);
  }

  async clearPasswordResetCode(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    await this.redisService.del(buildPasswordResetCodeKey(productScope, phone));
  }

  /**
   * 检查验证码校验尝试次数是否已超限
   * 超限后使验证码失效并抛出异常，防止暴力破解
   */
  private async ensureCodeAttemptsNotExceeded(
    codeType: 'register' | 'password-reset',
    productScope: AuthProductScope,
    phone: string,
  ): Promise<void> {
    const attemptsKey = buildCodeAttemptsKey(codeType, productScope, phone);
    const rawAttempts = await this.redisService.get(attemptsKey);
    const attempts = Number.parseInt(rawAttempts ?? '0', 10);

    if (attempts >= AUTH_CODE_MAX_ATTEMPTS) {
      // 超限：同时清除验证码，使其彻底失效
      if (codeType === 'register') {
        await this.clearRegisterCode(phone, productScope);
      } else {
        await this.clearPasswordResetCode(phone, productScope);
      }
      throw new UnauthorizedException(`验证码错误次数过多，请重新获取验证码`);
    }
  }

  /**
   * 原子递增验证码校验尝试次数
   * 首次失败时自动设置 TTL，后续失败仅递增
   */
  private async incrementCodeAttempts(
    codeType: 'register' | 'password-reset',
    productScope: AuthProductScope,
    phone: string,
  ): Promise<void> {
    const attemptsKey = buildCodeAttemptsKey(codeType, productScope, phone);
    await this.redisService.incr(
      attemptsKey,
      AUTH_CODE_ATTEMPTS_LOCK_TTL_SECONDS,
    );
  }

  /**
   * 清除验证码校验尝试次数计数（验证成功时调用）
   */
  private async clearCodeAttempts(
    codeType: 'register' | 'password-reset',
    productScope: AuthProductScope,
    phone: string,
  ): Promise<void> {
    const attemptsKey = buildCodeAttemptsKey(codeType, productScope, phone);
    await this.redisService.del(attemptsKey);
  }
}
