import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordOperationResponseDto } from './dto/password-operation-response.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { SendRegisterCodeResponseDto } from './dto/send-register-code-response.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { VerifyRealNameDto } from './dto/verify-real-name.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/send-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送注册短信验证码' })
  @ApiOkResponse({
    description: '发送注册验证码成功',
    type: SendRegisterCodeResponseDto,
  })
  sendRegisterCode(
    @Body() dto: SendRegisterCodeDto,
  ): Promise<SendRegisterCodeResponseDto> {
    return this.authService.sendRegisterCode(dto);
  }

  @Post('register')
  @ApiOperation({ summary: '注册' })
  @ApiCreatedResponse({
    description: '注册成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  register(@Body() dto: RegisterDto): Promise<AuthTokenResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登录' })
  @ApiOkResponse({
    description: '登录成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  login(@Body() dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.authService.login(dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改当前账号密码' })
  @ApiOkResponse({
    description: '修改密码成功并返回新的 JWT token',
    type: PasswordOperationResponseDto,
  })
  changePassword(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: ChangePasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    return this.authService.changePassword(request.user, dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送找回密码短信验证码' })
  @ApiOkResponse({
    description: '如手机号存在则发送验证码短信，统一返回通用文案',
    type: ForgotPasswordResponseDto,
  })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '通过短信验证码重置密码' })
  @ApiOkResponse({
    description: '重置密码成功并返回新的 JWT token',
    type: PasswordOperationResponseDto,
  })
  resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '获取当前登录用户信息与权限上下文（兼容前端 me 接口）',
  })
  @ApiOkResponse({
    description: '返回当前用户信息、当前门店与权限上下文',
    type: ProfileResponseDto,
  })
  me(@Req() request: { user: AuthenticatedUser }): Promise<ProfileResponseDto> {
    return this.authService.getProfile(request.user);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户信息与权限上下文' })
  @ApiOkResponse({
    description: '返回当前用户信息、当前门店与权限上下文',
    type: ProfileResponseDto,
  })
  profile(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<ProfileResponseDto> {
    return this.authService.getProfile(request.user);
  }

  @Patch('profile/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新当前用户头像' })
  @ApiOkResponse({
    description: '更新头像成功并返回最新资料',
    type: ProfileResponseDto,
  })
  updateAvatar(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: UpdateAvatarDto,
  ): Promise<ProfileResponseDto> {
    return this.authService.updateAvatar(request.user, dto);
  }

  @Post('real-name/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '提交当前账号实名认证信息' })
  @ApiOkResponse({
    description: '实名认证成功并返回最新资料',
    type: ProfileResponseDto,
  })
  verifyRealName(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: VerifyRealNameDto,
  ): Promise<ProfileResponseDto> {
    return this.authService.verifyRealName(request.user, dto);
  }
}
