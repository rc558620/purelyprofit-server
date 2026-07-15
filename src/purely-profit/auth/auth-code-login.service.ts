import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { resolveAuthIdentity } from './auth.utils';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthCodeService } from './auth-code.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthSessionService } from './auth-session.service';
import type { AuthenticatedAccountScope } from './auth-account.types';
import type {
  LoginByCodeAuthParams,
  LoginByCodeOrRegisterAuthParams,
} from './auth-password.types';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';

/**
 * 验证码登录服务。
 *
 * 职责：
 * - 手机号 + 验证码登录（loginByCode）
 * - 手机号验证码登录即注册（loginByCodeOrRegister，purely-club 专用）
 */
@Injectable()
export class AuthCodeLoginService {
  private readonly pulseDevAccountEmails: Set<string>;
  private readonly adminLoginPhone: string;

  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authCodeService: AuthCodeService,
    private readonly authPasswordService: AuthPasswordService,
    private readonly authSessionService: AuthSessionService,
    configService: ConfigService,
  ) {
    this.pulseDevAccountEmails = new Set(
      (configService.get<string[]>('pulse.devAccountEmails') ?? []).map(
        (email) => email.trim().toLowerCase(),
      ),
    );
    this.adminLoginPhone =
      configService.get<string>('auth.adminLoginPhone') ?? '13619654020';
  }

  async loginByCode(
    params: LoginByCodeAuthParams,
  ): Promise<AuthTokenResponseDto> {
    await this.authCodeService.ensureRegisterCodeValid(
      params.phone,
      params.code,
      params.productScope,
    );

    const user = await this.authAccountLookupService.findUserByPhone(
      params.phone,
      params.productScope,
    );

    if (!user) {
      await this.authCodeService.clearRegisterCode(
        params.phone,
        params.productScope,
      );
      throw new UnauthorizedException('验证码无效或已过期');
    }

    const resolvedAccountScope = this.resolveAccountScopeForLogin(user);

    await this.authCodeService.clearRegisterCode(
      params.phone,
      params.productScope,
    );

    return this.completeLogin(user, resolvedAccountScope);
  }

  /**
   * 手机号验证码登录即注册（purely-club 专用）
   *
   * 流程：
   * 1. 校验验证码有效性
   * 2. 查找已有账号 → 有则直接登录
   * 3. 无则自动创建账号（登录即注册）并签发 token
   * 4. 清除已消费的验证码
   */
  async loginByCodeOrRegister(
    params: LoginByCodeOrRegisterAuthParams,
  ): Promise<AuthTokenResponseDto> {
    await this.authCodeService.ensureRegisterCodeValid(
      params.phone,
      params.code,
      params.productScope,
    );

    const existingUser = await this.authAccountLookupService.findUserByPhone(
      params.phone,
      params.productScope,
    );

    await this.authCodeService.clearRegisterCode(
      params.phone,
      params.productScope,
    );

    if (existingUser) {
      const resolvedAccountScope =
        this.resolveAccountScopeForLogin(existingUser);
      return this.completeLogin(existingUser, resolvedAccountScope);
    }

    // 自动注册：无需验证码外的额外信息，使用随机占位密码
    const randomPassword = randomBytes(16).toString('hex');

    try {
      const newUser = await this.authPasswordService.createUserFromPhone({
        phone: params.phone,
        password: randomPassword,
        productScope: params.productScope,
      });

      return this.completeLogin(
        {
          ...newUser,
          phone: params.phone,
        },
        newUser.accountScope as AuthenticatedAccountScope,
      );
    } catch (error) {
      // 并发首登下，两个请求可能同时通过验证码校验并竞争创建同一手机号账号。
      // 若一个请求已创建成功，这里应回退为"已存在账号直接登录"，避免把正常并发打成 500。
      if (this.isUniqueConstraintError(error)) {
        const resolvedUser =
          await this.authAccountLookupService.findUserByPhone(
            params.phone,
            params.productScope,
          );
        if (resolvedUser) {
          const resolvedAccountScope =
            this.resolveAccountScopeForLogin(resolvedUser);
          return this.completeLogin(resolvedUser, resolvedAccountScope);
        }
      }
      throw error;
    }
  }

  /**
   * 验证码登录的 completeLogin：仅处理 purely_club 场景，直接签发 token。
   */
  private async completeLogin(
    user: { id: number; phone: string; email: string; staffId?: number },
    accountScope: AuthenticatedAccountScope,
  ): Promise<AuthTokenResponseDto> {
    return this.authSessionService.signToken(user.id, {
      phone: user.phone,
      email: user.email,
      accountScope,
      ...(user.staffId != null ? { staffId: user.staffId } : {}),
    });
  }

  private resolveAccountScopeForLogin(user: {
    email: string;
    phone: string;
    accountScope: AuthenticatedAccountScope;
  }): AuthenticatedAccountScope {
    return resolveAuthIdentity(
      user.email,
      user.phone,
      this.pulseDevAccountEmails,
      this.adminLoginPhone,
    ).accountScope;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
