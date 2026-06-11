import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
import { ClubAuthService } from './club-auth.service';

@ApiTags('Club / Auth')
@Controller('club/auth')
export class ClubAuthController {
  constructor(private readonly clubAuthService: ClubAuthService) {}

  @Post('register/send-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '发送 purely-club 注册短信验证码',
    description:
      '面向 purely-club 个人端账号注册。仅为 purely-club 新账号发送验证码，不适用于 purely-profit 或 purely-pulse 登录入口。',
  })
  @ApiOkResponse({
    description: '发送 purely-club 注册验证码成功',
    type: SendRegisterCodeResponseDto,
  })
  sendRegisterCode(
    @Body() dto: SendRegisterCodeDto,
  ): Promise<SendRegisterCodeResponseDto> {
    return this.clubAuthService.sendRegisterCode(dto);
  }

  @Post('login/send-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '发送 purely-club 登录短信验证码',
    description:
      '仅面向 purely-club 已注册账号发送登录验证码。即使手机号不存在也返回统一文案，不暴露注册状态。',
  })
  @ApiOkResponse({
    description: '如手机号已注册则发送 purely-club 登录验证码短信，统一返回通用文案',
    type: SendLoginCodeResponseDto,
  })
  sendLoginCode(
    @Body() dto: SendRegisterCodeDto,
  ): Promise<SendLoginCodeResponseDto> {
    return this.clubAuthService.sendLoginCode(dto);
  }

  @Post('register')
  @ApiOperation({
    summary: 'purely-club 注册',
    description:
      '创建 purely-club 个人端账号。注册成功后的账号仅用于 purely-club 登录；不能直接用于 purely-profit 或 purely-pulse 登录入口。',
  })
  @ApiCreatedResponse({
    description: 'purely-club 注册成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  register(@Body() dto: RegisterDto): Promise<AuthTokenResponseDto> {
    return this.clubAuthService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'purely-club 登录',
    description:
      '仅接受 purely-club 个人端账号登录。purely-profit 注册账号与非开发者账号不能通过该入口登录 purely-club。',
  })
  @ApiOkResponse({
    description: 'purely-club 登录成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  login(@Body() dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.clubAuthService.login(dto);
  }

  @Post('login/code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '通过短信验证码登录 purely-club',
    description:
      '仅接受 purely-club 已注册账号通过手机号验证码登录。登录成功后返回 JWT token，并消费当前验证码。',
  })
  @ApiOkResponse({
    description: 'purely-club 验证码登录成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  loginByCode(@Body() dto: LoginByCodeDto): Promise<AuthTokenResponseDto> {
    return this.clubAuthService.loginByCode(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '发送 purely-club 找回密码短信验证码',
    description:
      '仅面向 purely-club 账号找回密码。即使手机号不存在也返回统一文案，不暴露注册状态。',
  })
  @ApiOkResponse({
    description: '如手机号存在则发送 purely-club 找回密码验证码短信，统一返回通用文案',
    type: ForgotPasswordResponseDto,
  })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    return this.clubAuthService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '通过短信验证码重置 purely-club 密码',
    description:
      '仅重置 purely-club 账号密码。重置成功后返回新的 JWT token，并使旧登录态失效。',
  })
  @ApiOkResponse({
    description: '重置 purely-club 密码成功并返回新的 JWT token',
    type: PasswordOperationResponseDto,
  })
  resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    return this.clubAuthService.resetPassword(dto);
  }
}
