import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthRsaService } from '../../purely-profit/auth/auth-rsa.service';
import { AuthTokenResponseDto } from '../../purely-profit/auth/dto/auth-token-response.dto';
import { LoginDto } from '../../purely-profit/auth/dto/login.dto';
import { PublicKeyResponseDto } from '../../purely-profit/auth/dto/public-key-response.dto';
import { PulseAuthService } from './pulse-auth.service';

@ApiTags('Pulse / Auth')
@Controller('pulse/auth')
export class PulseAuthController {
  constructor(
    private readonly pulseAuthService: PulseAuthService,
    private readonly authRsaService: AuthRsaService,
  ) {}

  @Get('public-key')
  @Throttle({ default: { ttl: 60, limit: 10 } })
  @ApiOperation({
    summary: '获取 purely-pulse RSA 公钥',
    description:
      '返回 PEM 格式 RSA 公钥，前端用于加密密码等敏感字段。' +
      '密钥对在服务端进程重启后自动轮换，前端应在每次提交前重新获取。',
  })
  @ApiOkResponse({
    description: 'RSA 公钥',
    type: PublicKeyResponseDto,
  })
  getPublicKey(): PublicKeyResponseDto {
    return { publicKey: this.authRsaService.getPublicKey() };
  }

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
  async login(@Body() dto: LoginDto): Promise<AuthTokenResponseDto> {
    const decryptedDto = {
      ...dto,
      password: this.authRsaService.tryDecryptPassword(dto.password),
    };
    return this.pulseAuthService.login(decryptedDto);
  }
}
