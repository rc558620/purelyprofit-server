import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AccountIdentifiers,
  AuthenticatedAccountScope,
  AuthProductScope,
  PhoneUserRecord,
} from './auth-account.types';
import { ensurePasswordConfirmation, resolveAuthIdentity } from './auth.utils';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthAccountMembershipService } from './auth-account-membership.service';
import { AuthAccountService } from './auth-account.service';
import { AuthCodeService } from './auth-code.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthSessionService } from './auth-session.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { PasswordOperationResponseDto } from './dto/password-operation-response.dto';
import type {
  ChangePasswordAuthParams,
  LoginAuthParams,
  LoginByCodeAuthParams,
  RegisterAuthParams,
  ResetPasswordAuthParams,
} from './auth-password.types';

@Injectable()
export class AuthAuthenticationService {
  private readonly pulseDevAccountEmails: Set<string>;

  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authAccountMembershipService: AuthAccountMembershipService,
    private readonly authAccountService: AuthAccountService,
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
  }

  async register(params: RegisterAuthParams): Promise<AuthTokenResponseDto> {
    ensurePasswordConfirmation(
      params.password,
      params.confirmPassword,
      '两次输入的密码不一致',
    );
    const existing = await this.authAccountLookupService.findUserByPhone(
      params.phone,
      params.productScope,
    );
    if (existing) {
      throw new ConflictException('手机号已被注册');
    }

    await this.authCodeService.ensureRegisterCodeValid(
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

    await this.authCodeService.clearRegisterCode(
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

    const user = await this.authAccountLookupService.findUserByLoginAccount(
      params.loginAccount,
      params.productScope,
    );

    if (
      !user ||
      !(await this.authPasswordService.verifyPassword(
        params.password,
        user.password,
      ))
    ) {
      throw new UnauthorizedException('账号或密码错误');
    }

    const resolvedAccountScope = this.resolveAccountScopeForLogin(user);

    if (params.requireDeveloper && resolvedAccountScope !== 'developer') {
      throw new UnauthorizedException(
        '当前账号不可登录 purely-pulse，请使用开发者账号',
      );
    }

    return this.completeLogin(user, params.productScope, resolvedAccountScope);
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

    return this.completeLogin(user, params.productScope, resolvedAccountScope);
  }

  async changePassword(
    params: ChangePasswordAuthParams,
  ): Promise<PasswordOperationResponseDto> {
    ensurePasswordConfirmation(
      params.newPassword,
      params.confirmPassword,
      '两次输入的新密码不一致',
    );
    const currentUser = await this.authPasswordService.changePassword({
      userId: params.userId,
      currentPassword: params.currentPassword,
      newPassword: params.newPassword,
    });

    await this.authSessionService.bumpTokenVersion(currentUser.id);
    const token = await this.authSessionService.signToken(currentUser.id, {
      phone: params.phone,
      email: currentUser.email,
      accountScope: params.accountScope,
    });

    return {
      message: '密码修改成功，旧登录态已失效',
      access_token: token.access_token,
    };
  }

  async resetPassword(
    params: ResetPasswordAuthParams,
  ): Promise<PasswordOperationResponseDto> {
    ensurePasswordConfirmation(
      params.password,
      params.confirmPassword,
      '两次输入的新密码不一致',
    );
    await this.authCodeService.ensurePasswordResetCodeValid(
      params.phone,
      params.code,
      params.productScope,
    );

    const user = await this.authAccountLookupService.findUserByPhone(
      params.phone,
      params.productScope,
    );

    if (!user) {
      await this.authCodeService.clearPasswordResetCode(
        params.phone,
        params.productScope,
      );
      throw new UnauthorizedException('验证码无效或已过期');
    }

    await this.authPasswordService.resetPassword(user, params.password);

    await Promise.all([
      this.authCodeService.clearPasswordResetCode(
        params.phone,
        params.productScope,
      ),
      this.authSessionService.bumpTokenVersion(user.id),
    ]);

    const token = await this.authSessionService.signToken(user.id, {
      phone: params.phone,
      email: user.email,
      accountScope: user.accountScope,
    });

    return {
      message: '密码重置成功，旧登录态已失效',
      access_token: token.access_token,
    };
  }

  private async completeLogin(
    user: PhoneUserRecord,
    productScope: AuthProductScope,
    accountScope: AuthenticatedAccountScope,
  ): Promise<AuthTokenResponseDto> {
    if (productScope === 'purely_profit') {
      await this.preparePurelyProfitLogin(user.id, {
        phone: user.phone,
        email: user.email,
        accountScope,
      });
    }

    return this.authSessionService.signToken(user.id, {
      phone: user.phone,
      email: user.email,
      accountScope,
    });
  }

  private async preparePurelyProfitLogin(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    await this.authAccountService.syncStaffMemberships(userId, identifiers);
    await this.authAccountMembershipService.ensureUserNotBanned(userId);
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
    ).accountScope;
  }
}
