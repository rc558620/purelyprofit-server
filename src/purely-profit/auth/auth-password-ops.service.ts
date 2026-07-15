import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ensurePasswordConfirmation } from './auth.utils';
import { validatePasswordLength } from '../../shared/password-policy.utils';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthCodeService } from './auth-code.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthSessionService } from './auth-session.service';
import { AuditLogService } from '../../shared/audit-log.service';
import type { AuthenticatedAccountScope } from './auth-account.types';
import type {
  ChangePasswordAuthParams,
  ResetPasswordAuthParams,
} from './auth-password.types';
import { PasswordOperationResponseDto } from './dto/password-operation-response.dto';

/**
 * 密码变更/重置编排服务。
 *
 * 职责：
 * - 密码校验 + 数据层变更（委托 AuthPasswordService）
 * - 会话全量淘汰 + 新会话注册 + token 签发
 * - 密码操作审计日志
 */
@Injectable()
export class AuthPasswordOpsService {
  private readonly adminLoginPhone: string;

  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authCodeService: AuthCodeService,
    private readonly authPasswordService: AuthPasswordService,
    private readonly authSessionService: AuthSessionService,
    private readonly auditLogService: AuditLogService,
    configService: ConfigService,
  ) {
    this.adminLoginPhone =
      configService.get<string>('auth.adminLoginPhone') ?? '13619654020';
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
    await this.authSessionService.removeAllSessions(currentUser.id);
    const sid = await this.authSessionService.registerSession(
      currentUser.id,
      this.resolveSessionCategory(params.phone, params.accountScope),
    );
    const token = await this.authSessionService.signToken(
      currentUser.id,
      {
        phone: params.phone,
        email: currentUser.email,
        accountScope: params.accountScope,
      },
      sid,
    );

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
      this.authSessionService.removeAllSessions(user.id),
    ]);

    const sid = await this.authSessionService.registerSession(
      user.id,
      this.resolveSessionCategory(
        params.phone,
        user.accountScope as AuthenticatedAccountScope,
      ),
    );

    const token = await this.authSessionService.signToken(
      user.id,
      {
        phone: params.phone,
        email: user.email,
        accountScope: user.accountScope,
      },
      sid,
    );

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

  /**
   * 根据手机号和账号范围确定会话类别
   */
  private resolveSessionCategory(
    phone: string,
    accountScope: AuthenticatedAccountScope,
  ): 'owner' | 'profit_club' | 'profit_main' {
    if (phone === this.adminLoginPhone) return 'owner';
    if (accountScope === 'purely_club') return 'profit_club';
    return 'profit_main';
  }
}
