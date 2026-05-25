import { Injectable } from '@nestjs/common';
import { AuthAccountService } from './auth-account.service';
import { AuthAuthenticationService } from './auth-authentication.service';
import { AuthCodeService } from './auth-code.service';
import { AuthProfileService } from './auth-profile.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordOperationResponseDto } from './dto/password-operation-response.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { SendRegisterCodeResponseDto } from './dto/send-register-code-response.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { VerifyRealNameDto } from './dto/verify-real-name.dto';
import type {
  ChangePasswordAuthParams,
  LoginAuthParams,
  RegisterAuthParams,
  ResetPasswordAuthParams,
} from './auth-password.types';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { normalizePhone } from './auth.utils';

@Injectable()
export class AuthService {
  constructor(
    private readonly authAuthenticationService: AuthAuthenticationService,
    private readonly authCodeService: AuthCodeService,
    private readonly authProfileService: AuthProfileService,
  ) {}

  async sendRegisterCode(
    dto: SendRegisterCodeDto,
  ): Promise<SendRegisterCodeResponseDto> {
    return this.authCodeService.sendRegisterCode(normalizePhone(dto.phone));
  }

  async register(dto: RegisterDto): Promise<AuthTokenResponseDto> {
    const params: RegisterAuthParams = {
      phone: normalizePhone(dto.phone),
      code: dto.code,
      password: dto.password,
      confirmPassword: dto.confirmPassword,
      name: dto.name,
    };

    return this.authAuthenticationService.register(params);
  }

  async login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    const params: LoginAuthParams = {
      loginAccount: dto.phone ?? dto.account,
      password: dto.password,
    };

    return this.authAuthenticationService.login(params);
  }

  async changePassword(
    user: AuthenticatedUser,
    dto: ChangePasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    const params: ChangePasswordAuthParams = {
      userId: user.id,
      phone: user.phone,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
      confirmPassword: dto.confirmPassword,
    };

    return this.authAuthenticationService.changePassword(params);
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    return this.authCodeService.sendPasswordResetCode(normalizePhone(dto.phone));
  }

  async resetPassword(
    dto: ResetPasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    const params: ResetPasswordAuthParams = {
      phone: normalizePhone(dto.phone),
      code: dto.code,
      password: dto.password,
      confirmPassword: dto.confirmPassword,
    };

    return this.authAuthenticationService.resetPassword(params);
  }

  async updateAvatar(
    user: AuthenticatedUser,
    dto: UpdateAvatarDto,
  ): Promise<ProfileResponseDto> {
    return this.authProfileService.updateAvatar(user, dto.avatar);
  }

  async verifyRealName(
    user: AuthenticatedUser,
    dto: VerifyRealNameDto,
  ): Promise<ProfileResponseDto> {
    return this.authProfileService.verifyRealName(
      user,
      dto.realName,
      dto.idNumber,
    );
  }

  async getProfile(user: AuthenticatedUser): Promise<ProfileResponseDto> {
    return this.authProfileService.getProfile(user);
  }
}
