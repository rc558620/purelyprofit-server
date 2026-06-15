import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClubAuthService } from './club-auth.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { LoginByCodeDto } from './dto/login-by-code.dto';
import { SendLoginCodeResponseDto } from './dto/send-login-code-response.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

@ApiTags('Club / Auth')
@Controller('club/auth')
export class ClubAuthController {
  constructor(private readonly clubAuthService: ClubAuthService) {}

  @Post('login/send-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '发送 purely-club 登录验证码',
    description:
      '无论手机号是否已注册均发送验证码。' +
      '验证码有效期由 AUTH_REGISTER_CODE_TTL_SECONDS 控制（默认 600 秒）。' +
      '后续通过 POST /club/auth/login/code 完成登录或自动注册。',
  })
  @ApiOkResponse({
    description: '验证码发送成功',
    type: SendLoginCodeResponseDto,
  })
  sendLoginCode(
    @Body() dto: SendRegisterCodeDto,
  ): Promise<SendLoginCodeResponseDto> {
    return this.clubAuthService.sendLoginCode(dto);
  }

  @Post('login/code')
  @HttpCode(HttpStatus.OK)
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
  @ApiOperation({
    summary: '微信小程序登录（登录即注册）',
    description:
      '使用微信小程序 wx.login() 返回的 code 完成登录。' +
      '服务端将 code 换取 openid（及 unionid），若该 openid 已有账号则登录并刷新微信昵称/头像；' +
      '若尚无账号，则自动创建 purely-club 账号后签发 JWT token。' +
      'nickname / avatar 为可选项，由前端通过 wx.getUserProfile 或授权组件获取后传入。',
  })
  @ApiCreatedResponse({
    description: '微信登录成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  wechatLogin(@Body() dto: WechatLoginDto): Promise<AuthTokenResponseDto> {
    return this.clubAuthService.wechatLogin(dto);
  }
}
