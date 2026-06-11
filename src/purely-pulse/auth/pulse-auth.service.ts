import { Injectable } from '@nestjs/common';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthTokenResponseDto } from '../../purely-profit/auth/dto/auth-token-response.dto';
import { LoginDto } from '../../purely-profit/auth/dto/login.dto';

@Injectable()
export class PulseAuthService {
  constructor(
    private readonly authProductAuthService: AuthProductAuthService,
  ) {}

  login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.authProductAuthService.login(dto, {
      productScope: 'purely_profit',
      requireDeveloper: true,
    });
  }
}
