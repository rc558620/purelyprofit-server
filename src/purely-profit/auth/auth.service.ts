import { Injectable } from '@nestjs/common';
import { AuthAuthenticationService } from './auth-authentication.service';
import { AuthCapabilityService } from './auth-capability.service';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
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
import type { ChangePasswordAuthParams } from './auth-password.types';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly authAuthenticationService: AuthAuthenticationService,
    private readonly authProductAuthService: AuthProductAuthService,
    private readonly authProfileService: AuthProfileService,
    private readonly authCapabilityService: AuthCapabilityService,
  ) {}

  async sendRegisterCode(
    dto: SendRegisterCodeDto,
  ): Promise<SendRegisterCodeResponseDto> {
    return this.authProductAuthService.sendRegisterCode(dto, 'purely_profit');
  }

  async register(dto: RegisterDto): Promise<AuthTokenResponseDto> {
    return this.authProductAuthService.register(dto, 'purely_profit');
  }

  async login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.authProductAuthService.login(dto, {
      productScope: 'purely_profit',
    });
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
    return this.authProductAuthService.forgotPassword(dto, 'purely_profit');
  }

  async resetPassword(
    dto: ResetPasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    return this.authProductAuthService.resetPassword(dto, 'purely_profit');
  }

  async updateAvatar(
    user: AuthenticatedUser,
    dto: UpdateAvatarDto,
  ): Promise<ProfileResponseDto> {
    return this.authProfileService.updateAvatar(user, dto.avatar);
  }

  async updateNickname(
    user: AuthenticatedUser,
    nickname: string,
  ): Promise<ProfileResponseDto> {
    return this.authProfileService.updateNickname(user, nickname);
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
}
