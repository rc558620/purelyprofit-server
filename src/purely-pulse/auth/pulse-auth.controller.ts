import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
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
  @ApiOperation({
    summary: 'purely-pulse 开发者登录',
    description:
      '仅接受开发者账号登录 purely-pulse。purely-profit 注册账号、purely-club 注册账号以及其他非开发者账号都会被拒绝。',
  })
  @ApiOkResponse({
    description: 'purely-pulse 开发者登录成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  login(@Body() dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.pulseAuthService.login(dto);
  }
}
