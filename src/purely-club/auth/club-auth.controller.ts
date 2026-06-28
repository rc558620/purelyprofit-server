import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubAuthService } from './club-auth.service';
import { AuthRsaService } from '../../purely-profit/auth/auth-rsa.service';
import { CaptchaTokenService } from '../../purely-profit/auth/captcha-token.service';
import { PublicKeyResponseDto } from '../../purely-profit/auth/dto/public-key-response.dto';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { BindPhoneDto } from './dto/bind-phone.dto';
import { LoginByCodeDto } from './dto/login-by-code.dto';
import { RegisterCaptchaTokenDto } from './dto/register-captcha-token.dto';
import { SendLoginCodeResponseDto } from './dto/send-login-code-response.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

@ApiTags('Club / Auth')
@Controller('club/auth')
export class ClubAuthController {
  constructor(
    private readonly clubAuthService: ClubAuthService,
    private readonly authRsaService: AuthRsaService,
    private readonly captchaTokenService: CaptchaTokenService,
  ) {}

  /**
   * 注册拼图验证令牌
   *
   * 前端完成拼图人机校验后，调用此接口将 captchaToken 注册到 Redis。
   * 后续发送短信验证码时，后端校验 token 有效且未过期才允许发送。
   * token 有效期 5 分钟，一次性消费。
   */
  @Post('captcha/register')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 30 } })
  @ApiOperation({
    summary: '注册拼图验证令牌',
    description:
      '前端完成拼图验证后调用此接口注册 captchaToken 到服务端。' +
      '后续发送短信验证码时需携带该 token，后端校验通过后才允许发送。' +
      'token 有效期 5 分钟，一次性消费。',
  })
  registerCaptchaToken(
    @Body() dto: RegisterCaptchaTokenDto,
  ): Promise<{ success: boolean }> {
    return this.captchaTokenService.issue(dto.captchaToken).then(() => ({
      success: true,
    }));
  }

  @Get('public-key')
  @ApiOperation({
    summary: '获取 purely-club RSA 公钥',
    description:
      '返回 PEM 格式 RSA 公钥，前端用于加密敏感字段。' +
      '密钥对在服务端进程重启后自动轮换，前端应在每次提交前重新获取。',
  })
  @ApiOkResponse({
    description: 'RSA 公钥',
    type: PublicKeyResponseDto,
  })
  getPublicKey(): PublicKeyResponseDto {
    return { publicKey: this.authRsaService.getPublicKey() };
  }

  @Post('login/send-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 3 } })
  @ApiOperation({
    summary: '发送 purely-club 登录验证码',
    description:
      '无论手机号是否已注册均发送验证码。' +
      '同一手机号 60 秒内不可重复发送。' +
      '验证码有效期由 AUTH_REGISTER_CODE_TTL_SECONDS 控制（默认 600 秒）。' +
      '后续通过 POST /club/auth/login/code 完成登录或自动注册。' +
      '需先完成前端拼图验证，携带 captchaToken 才能发送短信。',
  })
  @ApiOkResponse({
    description: '验证码发送成功；同一手机号 60 秒内不可重复发送',
    type: SendLoginCodeResponseDto,
  })
  sendLoginCode(
    @Body() dto: SendRegisterCodeDto,
  ): Promise<SendLoginCodeResponseDto> {
    return this.clubAuthService.sendLoginCode(dto);
  }

  @Post('login/code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 10 } })
  @ApiOperation({
    summary: '手机号验证码登录（登录即注册）',
    description:
      '使用手机号 + 验证码完成登录。' +
      '若该手机号在 purely-club 尚无账号，将自动创建账号后签发 JWT token。' +
      '验证码来自 POST /club/auth/login/send-code，一次性消费。',
  })
  @ApiOkResponse({
    description: '登录成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  loginByCode(@Body() dto: LoginByCodeDto): Promise<AuthTokenResponseDto> {
    return this.clubAuthService.loginByCode(dto);
  }

  @Post('login/wechat')
  @Throttle({ default: { ttl: 60, limit: 10 } })
  @ApiOperation({
    summary: '微信小程序登录（登录即注册）',
    description:
      '使用微信小程序 wx.login() 返回的 code 完成登录。' +
      '服务端将 code 换取 openid（及 unionid），若该 openid 已有账号则登录并刷新微信昵称/头像；' +
      '若尚无账号，则自动创建 purely-club 账号后签发 JWT token。' +
      'nickname / avatar 为可选项，由前端通过 wx.getUserProfile 或授权组件获取后传入。' +
      '若账号尚未绑定手机号，响应中 needPhoneBind=true，前端应跳转绑定手机号页面。',
  })
  @ApiCreatedResponse({
    description: '微信登录成功，返回 JWT token（可能含 needPhoneBind 标志）',
    type: AuthTokenResponseDto,
  })
  wechatLogin(@Body() dto: WechatLoginDto): Promise<AuthTokenResponseDto> {
    return this.clubAuthService.wechatLogin(dto);
  }

  @Post('bind-phone/send-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60, limit: 3 } })
  @ApiOperation({
    summary: '发送绑定手机号验证码',
    description:
      '微信登录成功后，若 needPhoneBind=true，前端跳转绑定页先调用此接口发送验证码。' +
      '同一手机号 60 秒内不可重复发送。' +
      '验证码有效期由 AUTH_REGISTER_CODE_TTL_SECONDS 控制（默认 600 秒）。' +
      '后续通过 POST /club/auth/bind-phone 完成绑定。' +
      '需先完成前端拼图验证，携带 captchaToken 才能发送短信。',
  })
  @ApiOkResponse({
    description: '验证码发送成功；同一手机号 60 秒内不可重复发送',
    type: SendLoginCodeResponseDto,
  })
  sendBindPhoneCode(
    @CurrentUser() _user: AuthenticatedUser,
    @Body() dto: SendRegisterCodeDto,
  ): Promise<SendLoginCodeResponseDto> {
    return this.clubAuthService.sendBindPhoneCode(dto);
  }

  @Post('bind-phone')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60, limit: 10 } })
  @ApiOperation({
    summary: '微信登录后绑定手机号',
    description:
      '微信登录成功后，若 needPhoneBind=true，前端跳转绑定页调用此接口。' +
      '验证码来自 POST /club/auth/bind-phone/send-code。' +
      '若手机号已有账号，自动将微信 openid 合并到手机号账号；否则直接绑定到当前用户。' +
      '绑定成功后返回新 JWT token。',
  })
  @ApiOkResponse({
    description: '绑定成功，返回新 JWT token',
    type: AuthTokenResponseDto,
  })
  bindPhone(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BindPhoneDto,
  ): Promise<AuthTokenResponseDto> {
    return this.clubAuthService.bindPhone(user.id, dto);
  }
}
