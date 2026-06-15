import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type {
  AccountIdentifiers,
  AuthenticatedAccountScope,
  AuthProductScope,
  PhoneUserRecord,
} from './auth-account.types';
import {
  buildClubWechatMemberPhone,
  ensurePasswordConfirmation,
  resolveAuthIdentity,
} from './auth.utils';
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
  CreateUserFromWechatParams,
  LoginAuthParams,
  LoginByCodeAuthParams,
  LoginByCodeOrRegisterAuthParams,
  RegisterAuthParams,
  ResetPasswordAuthParams,
  WechatLoginAuthParams,
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
      return this.completeLogin(
        existingUser,
        params.productScope,
        resolvedAccountScope,
      );
    }

    // 自动注册：无需验证码外的额外信息，使用随机占位密码
    const randomPassword = randomBytes(16).toString('hex');

    try {
      const newUser = await this.authPasswordService.createUserFromPhone({
        phone: params.phone,
        password: randomPassword,
        productScope: params.productScope,
      });

      return this.authSessionService.signToken(newUser.id, {
        phone: params.phone,
        email: newUser.email,
        accountScope: newUser.accountScope,
      });
    } catch (error) {
      // 并发首登下，两个请求可能同时通过验证码校验并竞争创建同一手机号账号。
      // 若一个请求已创建成功，这里应回退为“已存在账号直接登录”，避免把正常并发打成 500。
      if (this.isUniqueConstraintError(error)) {
        const resolvedUser =
          await this.authAccountLookupService.findUserByPhone(
            params.phone,
            params.productScope,
          );
        if (resolvedUser) {
          const resolvedAccountScope =
            this.resolveAccountScopeForLogin(resolvedUser);
          return this.completeLogin(
            resolvedUser,
            params.productScope,
            resolvedAccountScope,
          );
        }
      }
      throw error;
    }
  }

  /**
   * 微信小程序登录即注册（purely-club 专用）
   *
   * 流程：
   * 1. 用 openid 查找已绑定的用户 → 有则刷新微信信息并登录
   *    - 若同时传入了 phone，额外将 wechat_phone 写入数据库（供手机号侧查找）
   * 2. 若 openid 未绑定任何账号，且传入了 phone：
   *    - 尝试用 phone 查找已有的手机号登录账号
   *    - 找到则将 wechat_openid 绑定到该账号（账号合并，手机号和微信共用同一账号）
   * 3. 若均无匹配，以 openid 创建新用户，phone 写入 wechat_phone 字段
   */
  async wechatLogin(
    params: WechatLoginAuthParams,
  ): Promise<AuthTokenResponseDto> {
    const existingUser =
      await this.authAccountLookupService.findUserByWechatOpenid(params.openid);

    if (existingUser) {
      // 每次登录刷新微信头像、昵称和 unionid
      await this.authAccountLookupService.updateWechatProfile(existingUser.id, {
        nickname: params.nickname,
        avatar: params.avatar,
        unionid: params.unionid,
      });

      // 若本次传入了手机号，顺便写入 wechat_phone（可能是首次绑定）
      if (params.phone) {
        await this.authAccountLookupService.updateWechatPhone(
          existingUser.id,
          params.phone,
        );
      }

      return this.authSessionService.signToken(existingUser.id, {
        phone: existingUser.phone,
        email: existingUser.email,
        accountScope: 'purely_club',
      });
    }

    // openid 未绑定账号。若有真实手机号，先尝试找手机号账号并合并
    if (params.phone) {
      const phoneUser = await this.authAccountLookupService.findUserByPhone(
        params.phone,
        params.productScope,
      );

      if (phoneUser) {
        // 手机号账号已存在：将 openid 绑定到该账号（账号合并）
        await this.authAccountLookupService.bindWechatToUser(phoneUser.id, {
          openid: params.openid,
          unionid: params.unionid,
          nickname: params.nickname,
          avatar: params.avatar,
          phone: params.phone,
        });

        return this.authSessionService.signToken(phoneUser.id, {
          phone: phoneUser.phone,
          email: phoneUser.email,
          accountScope: 'purely_club',
        });
      }
    }

    // 首次微信登录且无对应手机号账号：自动注册
    const createParams: CreateUserFromWechatParams = {
      openid: params.openid,
      unionid: params.unionid,
      nickname: params.nickname,
      avatar: params.avatar,
      phone: params.phone,
      productScope: params.productScope,
    };

    try {
      const newUser =
        await this.authPasswordService.createUserFromWechat(createParams);

      return this.authSessionService.signToken(newUser.id, {
        // 若拿到了真实手机号，使用真实手机号作为 JWT phone；否则用 openid 派生标识
        phone: params.phone ?? buildClubWechatMemberPhone(params.openid),
        email: newUser.email,
        accountScope: 'purely_club',
      });
    } catch (error) {
      // 并发首个微信登录时，可能被唯一索引 wechat_openid / email 抢占。
      // 这里回退成读取已创建账号并登录，避免正常重复点击直接 500。
      if (this.isUniqueConstraintError(error)) {
        const resolvedUser =
          await this.authAccountLookupService.findUserByWechatOpenid(
            params.openid,
          );
        if (resolvedUser) {
          return this.authSessionService.signToken(resolvedUser.id, {
            phone: resolvedUser.phone,
            email: resolvedUser.email,
            accountScope: 'purely_club',
          });
        }
      }
      throw error;
    }
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

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
