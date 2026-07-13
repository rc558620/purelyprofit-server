import { CurrentUser } from './current-user.decorator';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { AuthRsaService } from './auth-rsa.service';
import { CaptchaTokenService } from './captcha-token.service';
import { RegisterCaptchaTokenDto } from '../../purely-club/auth/dto/register-captcha-token.dto';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordOperationResponseDto } from './dto/password-operation-response.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { AuthCapabilityResponseDto } from './dto/capability-response.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { SendRegisterCodeResponseDto } from './dto/send-register-code-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UpdateNicknameDto } from './dto/update-nickname.dto';
import { VerifyRealNameDto } from './dto/verify-real-name.dto';
import { PublicKeyResponseDto } from './dto/public-key-response.dto';
import { CreateStoreDto } from '../stores/dto/create-store.dto';
import { RegisterStoreResponseDto } from './auth-register-store.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

@ApiTags('Profit / Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authRsaService: AuthRsaService,
    private readonly captchaTokenService: CaptchaTokenService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  @Get('public-key')
  @Throttle({ default: { ttl: 60, limit: 10 } })
  @ApiOperation({
    summary: '获取 RSA 公钥',
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

  @Post('register/send-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 3 } })
  @ApiOperation({
    summary: '发送 purely-profit 注册短信验证码',
    description:
      '面向 purely-profit 老板端/商家端账号注册。仅为 purely-profit 新账号发送验证码，不适用于 purely-club 或 purely-pulse 登录入口。60 秒内不可重复发送。',
  })
  @ApiOkResponse({
    description:
      '发送 purely-profit 注册验证码成功；同一手机号 60 秒内不可重复发送',
    type: SendRegisterCodeResponseDto,
  })
  sendRegisterCode(
    @Body() dto: SendRegisterCodeDto,
  ): Promise<SendRegisterCodeResponseDto> {
    return this.authService.sendRegisterCode(dto);
  }

  @Post('register')
  @Throttle({ default: { ttl: 60, limit: 5 } })
  @ApiOperation({
    summary: 'purely-profit 注册',
    description:
      '创建 purely-profit 老板端/商家端账号。注册成功后的账号仅用于 purely-profit 登录；如需个人端账号，请使用 purely-club 注册入口。',
  })
  @ApiCreatedResponse({
    description: 'purely-profit 注册成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  register(@Body() dto: RegisterDto): Promise<AuthTokenResponseDto> {
    const decryptedDto = {
      ...dto,
      password: this.authRsaService.tryDecryptPassword(dto.password),
      ...(dto.confirmPassword
        ? {
            confirmPassword: this.authRsaService.tryDecryptPassword(
              dto.confirmPassword,
            ),
          }
        : {}),
    };
    return this.authService.register(decryptedDto);
  }

  @Post('register/store')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '注册闭环——创建门店',
    description:
      '注册完成后第二步创建门店。路径挂载在 /auth/register/store 以对齐前端注册流程。' +
      '创建成功后返回门店信息与新的 JWT token，前端应立即用新 token 替换旧 token 以获得门店权限。',
  })
  @ApiCreatedResponse({
    description: '创建门店成功，返回门店信息与新 JWT token',
    type: RegisterStoreResponseDto,
  })
  registerStore(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStoreDto,
  ): Promise<RegisterStoreResponseDto> {
    return this.authService.registerStore(user, dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 10 } })
  @ApiOperation({
    summary: 'purely-profit 登录',
    description:
      '仅接受 purely-profit 老板端/商家端账号登录。purely-club 注册账号与非开发者账号不能通过该入口登录。' +
      '登录前需完成拼图验证，携带 captchaToken。',
  })
  @ApiOkResponse({
    description: 'purely-profit 登录成功，返回 JWT token',
    type: AuthTokenResponseDto,
  })
  async login(@Body() dto: LoginDto): Promise<AuthTokenResponseDto> {
    await this.captchaTokenService.validateAndConsume(dto.captchaToken);
    const decryptedDto = {
      ...dto,
      password: this.authRsaService.tryDecryptPassword(dto.password),
    };
    return this.authService.login(decryptedDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 30 } })
  @ApiOperation({
    summary: '刷新访问令牌',
    description:
      '使用 refresh_token 获取新的 access_token + refresh_token。' +
      '旧 refresh_token 立即失效（一次性轮换机制）。',
  })
  @ApiOkResponse({
    description: '刷新成功，返回新的 token pair',
    type: AuthTokenResponseDto,
  })
  async refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokenResponseDto> {
    const result = await this.authSessionService.refreshAccessToken(
      dto.refresh_token,
    );
    if (!result) {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }
    return result;
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 5 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改当前账号密码' })
  @ApiOkResponse({
    description: '修改密码成功并返回新的 JWT token',
    type: PasswordOperationResponseDto,
  })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    const decryptedDto = {
      ...dto,
      currentPassword: this.authRsaService.tryDecryptPassword(
        dto.currentPassword,
      ),
      newPassword: this.authRsaService.tryDecryptPassword(dto.newPassword),
      confirmPassword: this.authRsaService.tryDecryptPassword(
        dto.confirmPassword,
      ),
    };
    return this.authService.changePassword(user, decryptedDto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 5 } })
  @ApiOperation({
    summary: '发送 purely-profit 找回密码短信验证码',
    description:
      '仅面向 purely-profit 账号找回密码。会先校验手机号是否已注册；未注册时返回 404，已注册时发送验证码。同一手机号 60 秒内不可重复发送。',
  })
  @ApiOkResponse({
    description:
      '已注册手机号返回发送成功 message 并发送验证码；同一手机号 60 秒内不可重复发送',
    type: ForgotPasswordResponseDto,
  })
  @ApiNotFoundResponse({
    description: '手机号未注册，请先注册',
  })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 5 } })
  @ApiOperation({
    summary: '通过短信验证码重置 purely-profit 密码',
    description:
      '仅重置 purely-profit 账号密码。重置成功后返回新的 JWT token，并使旧登录态失效。',
  })
  @ApiOkResponse({
    description: '重置 purely-profit 密码成功并返回新的 JWT token',
    type: PasswordOperationResponseDto,
  })
  resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    const decryptedDto = {
      ...dto,
      password: this.authRsaService.tryDecryptPassword(dto.password),
      confirmPassword: this.authRsaService.tryDecryptPassword(
        dto.confirmPassword,
      ),
    };
    return this.authService.resetPassword(decryptedDto);
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
  me(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponseDto> {
    return this.authService.getProfile(user);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户信息与权限上下文' })
  @ApiOkResponse({
    description: '返回当前用户信息、当前门店与权限上下文',
    type: ProfileResponseDto,
  })
  profile(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponseDto> {
    return this.authService.getProfile(user);
  }

  @Get('capability')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录态的首页能力快照' })
  @ApiOkResponse({
    description: '返回 identityType、allowedHomeModules 等首页显隐能力字段',
    type: AuthCapabilityResponseDto,
  })
  capability(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AuthCapabilityResponseDto> {
    return this.authService.getCapability(user);
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
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAvatarDto,
  ): Promise<ProfileResponseDto> {
    return this.authService.updateAvatar(user, dto);
  }

  @Patch('profile/name')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新当前用户昵称' })
  @ApiOkResponse({
    description: '更新昵称成功并返回最新资料',
    type: ProfileResponseDto,
  })
  updateNickname(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNicknameDto,
  ): Promise<ProfileResponseDto> {
    return this.authService.updateNickname(user, dto.name);
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
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyRealNameDto,
  ): Promise<ProfileResponseDto> {
    return this.authService.verifyRealName(user, dto);
  }
}
