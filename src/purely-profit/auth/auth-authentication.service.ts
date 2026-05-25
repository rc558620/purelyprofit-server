import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ensurePasswordConfirmation } from './auth.utils';
import { AuthAccountService } from './auth-account.service';
import { AuthCodeService } from './auth-code.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthSessionService } from './auth-session.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { PasswordOperationResponseDto } from './dto/password-operation-response.dto';
import type {
  ChangePasswordAuthParams,
  LoginAuthParams,
  RegisterAuthParams,
  ResetPasswordAuthParams,
} from './auth-password.types';

@Injectable()
export class AuthAuthenticationService {
  constructor(
    private readonly authAccountService: AuthAccountService,
    private readonly authCodeService: AuthCodeService,
    private readonly authPasswordService: AuthPasswordService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async register(params: RegisterAuthParams): Promise<AuthTokenResponseDto> {
    ensurePasswordConfirmation(
      params.password,
      params.confirmPassword,
      '两次输入的密码不一致',
    );
    const existing = await this.authAccountService.findUserByPhone(params.phone);
    if (existing) {
      throw new ConflictException('手机号已被注册');
    }

    await this.authCodeService.ensureRegisterCodeValid(params.phone, params.code);

    const user = await this.authPasswordService.createUserFromPhone({
      phone: params.phone,
      name: params.name,
      password: params.password,
    });

    await Promise.all([
      this.authCodeService.clearRegisterCode(params.phone),
      this.authAccountService.syncStaffMemberships(user.id, {
        phone: params.phone,
        email: user.email,
      }),
    ]);

    return this.authSessionService.signToken(user.id, {
      phone: params.phone,
      email: user.email,
    });
  }

  async login(params: LoginAuthParams): Promise<AuthTokenResponseDto> {
    if (!params.loginAccount) {
      throw new BadRequestException('登录账号不能为空');
    }

    const user = await this.authAccountService.findUserByLoginAccount(
      params.loginAccount,
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

    await this.authAccountService.syncStaffMemberships(user.id, {
      phone: user.phone,
      email: user.email,
    });
    await this.authAccountService.ensureUserNotBanned(user.id);

    return this.authSessionService.signToken(user.id, {
      phone: user.phone,
      email: user.email,
    });
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
    );

    const user = await this.authAccountService.findUserByPhone(params.phone);

    if (!user) {
      await this.authCodeService.clearPasswordResetCode(params.phone);
      throw new UnauthorizedException('验证码无效或已过期');
    }

    await this.authPasswordService.resetPassword(user, params.password);

    await Promise.all([
      this.authCodeService.clearPasswordResetCode(params.phone),
      this.authSessionService.bumpTokenVersion(user.id),
    ]);

    const token = await this.authSessionService.signToken(user.id, {
      phone: params.phone,
      email: user.email,
    });

    return {
      message: '密码重置成功，旧登录态已失效',
      access_token: token.access_token,
    };
  }
}
