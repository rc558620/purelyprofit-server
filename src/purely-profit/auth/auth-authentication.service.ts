import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AccountIdentifiers,
  AuthenticatedAccountScope,
  AuthProductScope,
  SessionCategory,
} from './auth-account.types';
import {
  ensurePasswordConfirmation,
  extractPhoneFromLoginAccount,
  resolveAuthIdentity,
} from './auth.utils';
import { validatePasswordLength } from '../../shared/password-policy.utils';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthBanGuardService } from './auth-ban-guard.service';
import { AuthAccountService } from './auth-account.service';
import { AuthCodeVerifyService } from './auth-code-verify.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthPasswordOpsService } from './auth-password-ops.service';
import { AuthSessionService } from './auth-session.service';
import { AuthLoginFailGuardService } from './auth-login-fail-guard.service';
import { AuthPromoRecordService } from './auth-promo-record.service';
import { AuthCodeLoginService } from './auth-code-login.service';
import { AuthWechatLoginService } from './auth-wechat-login.service';
import {
  AUTH_LOGIN_FAIL_MAX_ATTEMPTS,
  AUTH_LOGIN_FAIL_WARNING_THRESHOLD,
} from './auth.constants';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { PasswordOperationResponseDto } from './dto/password-operation-response.dto';
import type {
  ChangePasswordAuthParams,
  LoginAuthParams,
  LoginByCodeAuthParams,
  LoginByCodeOrRegisterAuthParams,
  RegisterAuthParams,
  ResetPasswordAuthParams,
  WechatLoginAuthParams,
} from './auth-password.types';

@Injectable()
export class AuthAuthenticationService {
  private readonly logger = new Logger(AuthAuthenticationService.name);
  private readonly pulseDevAccountEmails: Set<string>;
  private readonly adminLoginPhone: string;

  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authBanGuardService: AuthBanGuardService,
    private readonly authAccountService: AuthAccountService,
    private readonly authCodeVerifyService: AuthCodeVerifyService,
    private readonly authPasswordService: AuthPasswordService,
    private readonly authPasswordOpsService: AuthPasswordOpsService,
    private readonly authSessionService: AuthSessionService,
    private readonly authLoginFailGuardService: AuthLoginFailGuardService,
    private readonly authPromoRecordService: AuthPromoRecordService,
    private readonly authCodeLoginService: AuthCodeLoginService,
    private readonly authWechatLoginService: AuthWechatLoginService,
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

  async register(params: RegisterAuthParams): Promise<AuthTokenResponseDto> {
    validatePasswordLength(params.password, '密码');
    ensurePasswordConfirmation(
      params.password,
      params.confirmPassword,
      '两次输入的密码不一致',
    );

    // 跨产品线手机号唯一性检查：防止同一手机号在多个产品线重复注册
    await this.authAccountLookupService.assertPhoneNotRegisteredInOtherScope(
      params.phone,
      params.productScope,
    );

    const existing = await this.authAccountLookupService.findUserByPhone(
      params.phone,
      params.productScope,
    );
    if (existing) {
      throw new ConflictException('手机号已被注册');
    }

    await this.authCodeVerifyService.ensureRegisterCodeValid(
      params.phone,
      params.code,
      params.productScope,
    );

    const user = await this.authPasswordService.createUserFromPhone({
      phone: params.phone,
      name: params.name,
      password: params.password,
      productScope: params.productScope,
    });

    await this.authCodeVerifyService.clearRegisterCode(
      params.phone,
      params.productScope,
    );

    if (params.productScope === 'purely_profit') {
      await this.authAccountService.syncStaffMemberships(user.id, {
        phone: params.phone,
        email: user.email,
        accountScope: params.productScope,
      });
    }

    // 推广码关联：注册时携带推广码则创建推广记录（异步，不阻塞注册响应）
    if (params.promoCode) {
      const promoCode = params.promoCode;
      void (async () => {
        try {
          await this.authPromoRecordService.tryCreatePromoRecord({
            promoCode,
            inviteePhone: params.phone,
            inviteeName: params.name ?? '',
          });
        } catch (err: unknown) {
          this.logger.warn(
            `推广记录创建失败（不影响注册主流程）: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    }

    return this.authSessionService.signToken(user.id, {
      phone: params.phone,
      email: user.email,
      accountScope: user.accountScope,
    });
  }

  async login(params: LoginAuthParams): Promise<AuthTokenResponseDto> {
    if (!params.loginAccount) {
      throw new BadRequestException('登录账号不能为空');
    }

    // 检查账号是否因多次登录失败被锁定
    await this.authLoginFailGuardService.ensureLoginNotLocked(
      params.loginAccount,
      params.productScope,
    );

    const user = await this.authAccountLookupService.findUserByLoginAccount(
      params.loginAccount,
      params.productScope,
    );

    if (!user) {
      // 用户不存在：不递增失败计数，避免攻击者预先“预订”锁定状态
      throw new UnauthorizedException('账号或密码错误');
    }

    const passwordValid = await this.authPasswordService.verifyPassword(
      params.password,
      user.password,
    );

    if (!passwordValid) {
      // 仅当用户存在且密码错误时才递增失败计数
      const newCount = await this.authLoginFailGuardService.recordLoginFailure(
        params.loginAccount,
        params.productScope,
      );
      const remaining = AUTH_LOGIN_FAIL_MAX_ATTEMPTS - newCount;

      if (remaining <= 0) {
        // 达到上限，账号已锁定——统一为通用消息避免泄露锁定状态
        throw new UnauthorizedException('账号或密码错误');
      }
      if (newCount >= AUTH_LOGIN_FAIL_WARNING_THRESHOLD) {
        throw new UnauthorizedException(
          `账号或密码错误，还剩 ${remaining} 次机会，再失败账号将被临时锁定`,
        );
      }
      throw new UnauthorizedException('账号或密码错误');
    }

    // 登录成功：清除失败计数 + 审计日志
    await this.authLoginFailGuardService.clearLoginFailures(
      params.loginAccount,
      params.productScope,
    );

    const resolvedAccountScope = this.resolveAccountScopeForLogin(user);

    if (params.requireDeveloper && resolvedAccountScope !== 'developer') {
      throw new UnauthorizedException(
        '当前账号不可登录 purely-pulse，请使用开发者账号',
      );
    }

    // 确定会话类别：手机号登录 → 主账号，自定义账号登录 → 子账号
    const isSubAccountLogin =
      params.productScope === 'purely_profit' &&
      !extractPhoneFromLoginAccount(params.loginAccount);
    const sessionCategory: SessionCategory = isSubAccountLogin
      ? 'profit_sub'
      : this.resolveSessionCategory(user.phone, resolvedAccountScope);

    return this.completeLogin(
      user,
      params.productScope,
      resolvedAccountScope,
      sessionCategory,
    );
  }

  /** 验证码登录（委托 AuthCodeLoginService） */
  loginByCode(params: LoginByCodeAuthParams): Promise<AuthTokenResponseDto> {
    return this.authCodeLoginService.loginByCode(params);
  }

  /** 验证码登录即注册（委托 AuthCodeLoginService） */
  loginByCodeOrRegister(
    params: LoginByCodeOrRegisterAuthParams,
  ): Promise<AuthTokenResponseDto> {
    return this.authCodeLoginService.loginByCodeOrRegister(params);
  }

  /** 微信小程序登录即注册（委托 AuthWechatLoginService） */
  wechatLogin(params: WechatLoginAuthParams): Promise<AuthTokenResponseDto> {
    return this.authWechatLoginService.wechatLogin(params);
  }

  /** 密码变更编排（委托 AuthPasswordOpsService） */
  changePassword(
    params: ChangePasswordAuthParams,
  ): Promise<PasswordOperationResponseDto> {
    return this.authPasswordOpsService.changePassword(params);
  }

  /** 密码重置编排（委托 AuthPasswordOpsService） */
  resetPassword(
    params: ResetPasswordAuthParams,
  ): Promise<PasswordOperationResponseDto> {
    return this.authPasswordOpsService.resetPassword(params);
  }

  // ── 私有辅助方法 ──────────────────────────────────────────

  /**
   * 根据手机号和账号范围确定会话类别
   */
  private resolveSessionCategory(
    phone: string,
    accountScope: AuthenticatedAccountScope,
  ): SessionCategory {
    if (phone === this.adminLoginPhone) return 'owner';
    if (accountScope === 'purely_club') return 'profit_club';
    return 'profit_main';
  }

  private async completeLogin(
    user: { id: number; phone: string; email: string; staffId?: number },
    productScope: AuthProductScope,
    accountScope: AuthenticatedAccountScope,
    sessionCategory?: SessionCategory,
  ): Promise<AuthTokenResponseDto> {
    if (productScope === 'purely_profit') {
      await this.preparePurelyProfitLogin(user.id, {
        phone: user.phone,
        email: user.email,
        accountScope,
      });
    }

    // club 用户也需检查封禁状态：若关联的所有门店都被封禁则拒绝登录
    if (productScope === 'purely_club') {
      await this.authBanGuardService.ensureUserNotBanned(user.id);
    }

    // purelyClub 不启用会话限制，直接签发 token
    if (productScope === 'purely_club') {
      return this.authSessionService.signToken(user.id, {
        phone: user.phone,
        email: user.email,
        accountScope,
        ...(user.staffId != null ? { staffId: user.staffId } : {}),
      });
    }

    // 精细化会话管理：注册新会话并按账号类型淘汰旧会话
    const fallbackCategory = this.resolveSessionCategory(
      user.phone,
      accountScope,
    );
    const category = sessionCategory ?? fallbackCategory;
    const sid = await this.authSessionService.registerSession(
      user.id,
      category,
    );

    return this.authSessionService.signToken(
      user.id,
      {
        phone: user.phone,
        email: user.email,
        accountScope,
        ...(user.staffId != null ? { staffId: user.staffId } : {}),
      },
      sid,
    );
  }

  private async preparePurelyProfitLogin(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    await this.authAccountService.syncStaffMemberships(userId, identifiers);
    await this.authBanGuardService.ensureUserNotBanned(userId);
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
}
