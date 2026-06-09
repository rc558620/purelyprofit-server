import { Injectable } from '@nestjs/common';
import type { AuthProductScope } from './auth-account.types';
import { AuthAuthenticationService } from './auth-authentication.service';
import { AuthCapabilityService } from './auth-capability.service';
import { AuthCodeService } from './auth-code.service';
import { AuthProfileService } from './auth-profile.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordOperationResponseDto } from './dto/password-operation-response.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { AuthCapabilityResponseDto } from './dto/capability-response.dto';
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
    private readonly authCapabilityService: AuthCapabilityService,
  ) {}

  async sendRegisterCode(
    dto: SendRegisterCodeDto,
  ): Promise<SendRegisterCodeResponseDto> {
    return this.sendRegisterCodeByScope(dto, 'purely_profit');
  }

  async sendClubRegisterCode(
    dto: SendRegisterCodeDto,
  ): Promise<SendRegisterCodeResponseDto> {
    return this.sendRegisterCodeByScope(dto, 'purely_club');
  }

  async register(dto: RegisterDto): Promise<AuthTokenResponseDto> {
    return this.registerByScope(dto, 'purely_profit');
  }

  async registerClub(dto: RegisterDto): Promise<AuthTokenResponseDto> {
    return this.registerByScope(dto, 'purely_club');
  }

  async login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.loginByScope(dto, 'purely_profit');
  }

  async loginClub(dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.loginByScope(dto, 'purely_club');
  }

  async loginPulse(dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.loginByScope(dto, 'purely_profit', true);
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
      accountScope: user.accountScope ?? 'purely_profit',
    };

    return this.authAuthenticationService.changePassword(params);
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    return this.forgotPasswordByScope(dto, 'purely_profit');
  }

  async forgotClubPassword(
    dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    return this.forgotPasswordByScope(dto, 'purely_club');
  }

  async resetPassword(
    dto: ResetPasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    return this.resetPasswordByScope(dto, 'purely_profit');
  }

  async resetClubPassword(
    dto: ResetPasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    return this.resetPasswordByScope(dto, 'purely_club');
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

  async getCapability(
    user: AuthenticatedUser,
  ): Promise<AuthCapabilityResponseDto> {
    return this.authCapabilityService.getCapability(user);
  }

  private async sendRegisterCodeByScope(
    dto: SendRegisterCodeDto,
    productScope: AuthProductScope,
  ): Promise<SendRegisterCodeResponseDto> {
    return this.authCodeService.sendRegisterCode(
      normalizePhone(dto.phone),
      productScope,
    );
  }

  private async registerByScope(
    dto: RegisterDto,
    productScope: AuthProductScope,
  ): Promise<AuthTokenResponseDto> {
    const params: RegisterAuthParams = {
      phone: normalizePhone(dto.phone),
      code: dto.code,
      password: dto.password,
      confirmPassword: dto.confirmPassword,
      name: dto.name,
      productScope,
    };

    return this.authAuthenticationService.register(params);
  }

  private async loginByScope(
    dto: LoginDto,
    productScope: AuthProductScope,
    requireDeveloper = false,
  ): Promise<AuthTokenResponseDto> {
    const params: LoginAuthParams = {
      loginAccount: dto.phone ?? dto.account,
      password: dto.password,
      productScope,
      requireDeveloper,
    };

    return this.authAuthenticationService.login(params);
  }

  private async forgotPasswordByScope(
    dto: ForgotPasswordDto,
    productScope: AuthProductScope,
  ): Promise<ForgotPasswordResponseDto> {
    return this.authCodeService.sendPasswordResetCode(
      normalizePhone(dto.phone),
      productScope,
    );
  }

  private async resetPasswordByScope(
    dto: ResetPasswordDto,
    productScope: AuthProductScope,
  ): Promise<PasswordOperationResponseDto> {
    const params: ResetPasswordAuthParams = {
      phone: normalizePhone(dto.phone),
      code: dto.code,
      password: dto.password,
      confirmPassword: dto.confirmPassword,
      productScope,
    };

    return this.authAuthenticationService.resetPassword(params);
  }
}
