import { Injectable } from '@nestjs/common';
import { AuthService } from '../../purely-profit/auth/auth.service';
import { AuthTokenResponseDto } from '../../purely-profit/auth/dto/auth-token-response.dto';
import { ForgotPasswordDto } from '../../purely-profit/auth/dto/forgot-password.dto';
import { ForgotPasswordResponseDto } from '../../purely-profit/auth/dto/forgot-password-response.dto';
import { LoginDto } from '../../purely-profit/auth/dto/login.dto';
import { RegisterDto } from '../../purely-profit/auth/dto/register.dto';
import { ResetPasswordDto } from '../../purely-profit/auth/dto/reset-password.dto';
import { SendRegisterCodeDto } from '../../purely-profit/auth/dto/send-register-code.dto';
import { SendRegisterCodeResponseDto } from '../../purely-profit/auth/dto/send-register-code-response.dto';
import { PasswordOperationResponseDto } from '../../purely-profit/auth/dto/password-operation-response.dto';

@Injectable()
export class ClubAuthService {
  constructor(private readonly authService: AuthService) {}

  sendRegisterCode(
    dto: SendRegisterCodeDto,
  ): Promise<SendRegisterCodeResponseDto> {
    return this.authService.sendClubRegisterCode(dto);
  }

  register(dto: RegisterDto): Promise<AuthTokenResponseDto> {
    return this.authService.registerClub(dto);
  }

  login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.authService.loginClub(dto);
  }

  forgotPassword(dto: ForgotPasswordDto): Promise<ForgotPasswordResponseDto> {
    return this.authService.forgotClubPassword(dto);
  }

  resetPassword(dto: ResetPasswordDto): Promise<PasswordOperationResponseDto> {
    return this.authService.resetClubPassword(dto);
  }
}
