import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type {
  AccountIdentifiers,
  AuthenticatedAccountScope,
  AuthProductScope,
} from './auth-account.types';
import {
  buildClubWechatMemberPhone,
  ensurePasswordConfirmation,
  resolveAuthIdentity,
} from './auth.utils';
import { validatePasswordLength } from '../../shared/password-policy.utils';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthBanGuardService } from './auth-ban-guard.service';
import { AuthAccountService } from './auth-account.service';
import { AuthCodeService } from './auth-code.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthSessionService } from './auth-session.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogService } from '../../shared/audit-log.service';
import {
  AUTH_LOGIN_FAIL_MAX_ATTEMPTS,
  AUTH_LOGIN_FAIL_LOCK_TTL_SECONDS,
  AUTH_LOGIN_FAIL_KEY_PREFIX,
  AUTH_LOGIN_FAIL_WARNING_THRESHOLD,
} from './auth.constants';
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
  private readonly logger = new Logger(AuthAuthenticationService.name);
  private readonly pulseDevAccountEmails: Set<string>;
  private readonly adminLoginPhone: string;

  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authBanGuardService: AuthBanGuardService,
    private readonly authAccountService: AuthAccountService,
    private readonly authCodeService: AuthCodeService,
    private readonly authPasswordService: AuthPasswordService,
    private readonly authSessionService: AuthSessionService,
    private readonly redisService: RedisService,
    private readonly auditLogService: AuditLogService,
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

    // 检查账号是否因多次登录失败被锁定
    await this.ensureLoginNotLocked(params.loginAccount, params.productScope);

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
      // 登录失败：递增失败计数并构建错误消息
      const newCount = await this.recordLoginFailure(
        params.loginAccount,
        params.productScope,
      );
      const remaining = AUTH_LOGIN_FAIL_MAX_ATTEMPTS - newCount;

      if (remaining <= 0) {
        // 达到上限，账号已锁定
        throw new UnauthorizedException(
          '账号或密码错误，账号已被临时锁定，请 15 分钟后再试',
        );
      }
      if (newCount >= AUTH_LOGIN_FAIL_WARNING_THRESHOLD) {
        throw new UnauthorizedException(
          `账号或密码错误，还剩 ${remaining} 次机会，再失败账号将被临时锁定`,
        );
      }
      throw new UnauthorizedException('账号或密码错误');
    }

    // 登录成功：清除失败计数 + 审计日志
    await this.clearLoginFailures(params.loginAccount, params.productScope);

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

      // 新注册用户也需走 completeLogin 以保持封禁检查一致性
      return this.completeLogin(
        {
          ...newUser,
          phone: params.phone,
        },
        params.productScope,
        newUser.accountScope as AuthenticatedAccountScope,
      );
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

      // 若本次传入了手机号，写入 wechat_phone 前，先检查该手机号是否已被其他用户绑定
      if (params.phone) {
        await this.safeUpdateWechatPhone(existingUser.id, params.phone);
      }

      await this.authBanGuardService.ensureUserNotBanned(existingUser.id);

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
        // 使用 try/catch 处理 wechatOpenid 唯一约束冲突（P2002）
        try {
          await this.authAccountLookupService.bindWechatToUser(phoneUser.id, {
            openid: params.openid,
            unionid: params.unionid,
            nickname: params.nickname,
            avatar: params.avatar,
            phone: params.phone,
          });
        } catch (error) {
          if (this.isUniqueConstraintError(error)) {
            throw new ConflictException(
              '该微信已绑定其他账号，无法自动合并，请联系客服',
            );
          }
          throw error;
        }

        await this.authBanGuardService.ensureUserNotBanned(phoneUser.id);

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
          await this.authBanGuardService.ensureUserNotBanned(resolvedUser.id);
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
    validatePasswordLength(params.newPassword, '新密码');
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
    await this.authSessionService.invalidateAllRefreshTokens(currentUser.id);
    const token = await this.authSessionService.signToken(currentUser.id, {
      phone: params.phone,
      email: currentUser.email,
      accountScope: params.accountScope,
    });

    // 密码变更审计日志
    this.auditLogService.record({
      userId: currentUser.id,
      action: 'password.change',
      resourceType: 'user',
      resourceId: String(currentUser.id),
    });

    return {
      message: '密码修改成功，旧登录态已失效',
      access_token: token.access_token,
    };
  }

  async resetPassword(
    params: ResetPasswordAuthParams,
  ): Promise<PasswordOperationResponseDto> {
    validatePasswordLength(params.password, '新密码');
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
      this.authSessionService.invalidateAllRefreshTokens(user.id),
    ]);

    const token = await this.authSessionService.signToken(user.id, {
      phone: params.phone,
      email: user.email,
      accountScope: user.accountScope,
    });

    // 密码重置审计日志
    this.auditLogService.record({
      userId: user.id,
      action: 'password.reset',
      resourceType: 'user',
      resourceId: String(user.id),
    });

    return {
      message: '密码重置成功，旧登录态已失效',
      access_token: token.access_token,
    };
  }

  private async completeLogin(
    user: { id: number; phone: string; email: string },
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

    // club 用户也需检查封禁状态：若关联的所有门店都被封禁则拒绝登录
    if (productScope === 'purely_club') {
      await this.authBanGuardService.ensureUserNotBanned(user.id);
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

  /**
   * 安全更新 wechatPhone：写入前先检查该手机号是否已被其他用户绑定，
   * 避免 A 用户的 wechatPhone 被覆盖为 B 用户手机号导致账号混淆。
   */
  private async safeUpdateWechatPhone(
    userId: number,
    phone: string,
  ): Promise<void> {
    const existingHolder =
      await this.authAccountLookupService.findUserByWechatPhone(phone);

    if (existingHolder && existingHolder.id !== userId) {
      // 手机号已被其他用户绑定，不覆盖，记录警告供后续人工客服或身份验证流程处理
      this.logger.warn(
        `wechatPhone 冲突：用户 ${userId} 尝试绑定手机号 ${phone}` +
          `，但该手机号已被用户 ${existingHolder.id}（email=${existingHolder.email}）绑定，已跳过`,
      );
      return;
    }

    await this.authAccountLookupService.updateWechatPhone(userId, phone);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  // ── 登录失败锁定机制 ──────────────────────────────────────

  private buildLoginFailKey(
    loginAccount: string,
    productScope: AuthProductScope,
  ): string {
    return `${AUTH_LOGIN_FAIL_KEY_PREFIX}${productScope}:${loginAccount.toLowerCase()}`;
  }

  /**
   * 检查账号是否因多次登录失败被临时锁定
   */
  private async ensureLoginNotLocked(
    loginAccount: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    const key = this.buildLoginFailKey(loginAccount, productScope);
    const rawCount = await this.redisService.get(key);
    const failCount = Number.parseInt(rawCount ?? '0', 10);

    if (failCount >= AUTH_LOGIN_FAIL_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        '登录失败次数过多，账号已被临时锁定，请 15 分钟后再试',
      );
    }
  }

  /**
   * 记录一次登录失败，使用 Redis INCR 原子递增。
   * @returns 递增后的失败计数
   */
  private async recordLoginFailure(
    loginAccount: string,
    productScope: AuthProductScope,
  ): Promise<number> {
    const key = this.buildLoginFailKey(loginAccount, productScope);
    const newCount = await this.redisService.incr(
      key,
      AUTH_LOGIN_FAIL_LOCK_TTL_SECONDS,
    );

    // 如果刚好达到阈值，设置锁定时长（重新设置 TTL 为锁定时长）
    if (newCount >= AUTH_LOGIN_FAIL_MAX_ATTEMPTS) {
      await this.redisService.set(
        key,
        String(newCount),
        AUTH_LOGIN_FAIL_LOCK_TTL_SECONDS,
      );
      // 账号锁定审计日志
      this.auditLogService.record({
        action: 'login.fail.lock',
        resourceType: 'user',
        resourceId: loginAccount.toLowerCase(),
        metadata: {
          productScope,
          failCount: newCount,
        },
      });
    }

    return newCount;
  }

  /**
   * 登录成功后清除失败计数
   */
  private async clearLoginFailures(
    loginAccount: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    const key = this.buildLoginFailKey(loginAccount, productScope);
    await this.redisService.del(key);
  }
}
