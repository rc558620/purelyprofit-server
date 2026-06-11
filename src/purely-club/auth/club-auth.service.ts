import { Injectable } from '@nestjs/common';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { LoginByCodeDto } from './dto/login-by-code.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordOperationResponseDto } from './dto/password-operation-response.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendLoginCodeResponseDto } from './dto/send-login-code-response.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { SendRegisterCodeResponseDto } from './dto/send-register-code-response.dto';

@Injectable()
export class ClubAuthService {
  constructor(
    private readonly authProductAuthService: AuthProductAuthService,
  ) {}

  sendRegisterCode(
    dto: SendRegisterCodeDto,
  ): Promise<SendRegisterCodeResponseDto> {
    return this.authProductAuthService.sendRegisterCode(dto, 'purely_club');
  }

  sendLoginCode(
    dto: SendRegisterCodeDto,
  ): Promise<SendLoginCodeResponseDto> {
    return this.authProductAuthService.sendLoginCode(dto, 'purely_club');
  }

  register(dto: RegisterDto): Promise<AuthTokenResponseDto> {
    return this.authProductAuthService.register(dto, 'purely_club');
  }

  login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.authProductAuthService.login(dto, {
      productScope: 'purely_club',
    });
  }

  loginByCode(dto: LoginByCodeDto): Promise<AuthTokenResponseDto> {
    return this.authProductAuthService.loginByCode(dto, 'purely_club');
  }

  forgotPassword(dto: ForgotPasswordDto): Promise<ForgotPasswordResponseDto> {
    return this.authProductAuthService.forgotPassword(dto, 'purely_club');
  }

  resetPassword(dto: ResetPasswordDto): Promise<PasswordOperationResponseDto> {
    return this.authProductAuthService.resetPassword(dto, 'purely_club');
  }
}
