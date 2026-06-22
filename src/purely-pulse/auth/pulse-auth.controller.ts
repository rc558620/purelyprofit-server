import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthTokenResponseDto } from '../../purely-profit/auth/dto/auth-token-response.dto';
import { LoginDto } from '../../purely-profit/auth/dto/login.dto';
import { PulseAuthService } from './pulse-auth.service';

@ApiTags('Pulse / Auth')
@Controller('pulse/auth')
export class PulseAuthController {
  constructor(private readonly pulseAuthService: PulseAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 10 } })
  @ApiOperation({
    summary: 'purely-pulse 开发者登录',
    description:
      '支持手机号或账号别名登录。仅开发者账号可登录 purely-pulse，非开发者账号（purely-profit 普通商家、purely-club 注册账号等）会被拒绝。',
  })
  @ApiOkResponse({
    description: 'purely-pulse 开发者登录成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  login(@Body() dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.pulseAuthService.login(dto);
  }
}
