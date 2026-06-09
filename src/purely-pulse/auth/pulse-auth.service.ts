import { Injectable } from '@nestjs/common';
import { AuthService } from '../../purely-profit/auth/auth.service';
import { AuthTokenResponseDto } from '../../purely-profit/auth/dto/auth-token-response.dto';
import { LoginDto } from '../../purely-profit/auth/dto/login.dto';

@Injectable()
export class PulseAuthService {
  constructor(private readonly authService: AuthService) {}

  login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.authService.loginPulse(dto);
  }
}
