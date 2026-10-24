import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthSmsModeService } from './auth-sms-mode.service';
import type { SmsMode } from './auth.constants';
import { SmsModeResponseDto } from './dto/sms-mode-response.dto';
import { UpdateSmsModeDto } from './dto/update-sms-mode.dto';

/** 切换短信通道时携带访问令牌的请求头名称。 */
const SMS_MODE_DEV_TOKEN_HEADER = 'x-sms-dev-token';

/**
 * 短信通道模式调试接口。
 *
 * 仅在非生产环境可用：生产环境一律伪装为路由不存在（404），
 * 切换请求还需通过服务端配置的访问令牌校验，避免测试环境公网可达时被任意切换。
 */
@ApiTags('Profit / Auth · 调试')
@Controller('auth/dev')
export class SmsModeController {
  private readonly logger = new Logger(SmsModeController.name);

  constructor(private readonly authSmsModeService: AuthSmsModeService) {}

  @Get('sms-mode')
  @Throttle({ default: { ttl: 60, limit: 30 } })
  @ApiOperation({
    summary: '查询当前短信通道模式',
    description:
      '仅供本地 / 测试环境调试使用，生产环境不可用。返回当前是测试模式（仅打印日志）还是真实接通模式。',
  })
  @ApiOkResponse({ description: '当前短信通道模式', type: SmsModeResponseDto })
  async getSmsMode(): Promise<SmsModeResponseDto> {
    this.ensureDevAvailable();
    return this.buildResponse(await this.authSmsModeService.getMode());
  }

  @Post('sms-mode')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60, limit: 10 } })
  @ApiOperation({
    summary: '切换短信通道模式',
    description:
      '在测试模式与真实接通模式之间切换，需在 `x-sms-dev-token` 请求头携带服务端配置的访问令牌。' +
      '切换结果 12 小时后自动回落为配置默认值，避免长期遗忘在真实发送状态。',
  })
  @ApiOkResponse({
    description: '切换后的短信通道模式',
    type: SmsModeResponseDto,
  })
  async updateSmsMode(
    @Body() dto: UpdateSmsModeDto,
    @Headers(SMS_MODE_DEV_TOKEN_HEADER) devToken?: string,
  ): Promise<SmsModeResponseDto> {
    this.ensureDevAvailable();

    if (!this.authSmsModeService.isDevTokenValid(devToken)) {
      this.logger.warn('[短信通道] 切换请求令牌校验失败，已拒绝');
      throw new UnauthorizedException('短信通道切换令牌无效或未配置');
    }

    const mode = await this.authSmsModeService.setMode(dto.mode);
    return this.buildResponse(mode);
  }

  /** 组装通道模式响应。 */
  private buildResponse(mode: SmsMode): SmsModeResponseDto {
    return {
      mode,
      switchEnabled: this.authSmsModeService.isSwitchEnabled(),
      devTokenConfigured: this.authSmsModeService.isDevTokenConfigured(),
      liveWhitelistEnabled: this.authSmsModeService.isLiveWhitelistEnabled(),
    };
  }

  /**
   * 生产环境或已关闭切换开关时，伪装为路由不存在。
   * 用 404 而非 403，避免向外部暴露该调试接口的存在。
   */
  private ensureDevAvailable(): void {
    if (
      this.authSmsModeService.isProduction() ||
      !this.authSmsModeService.isSwitchEnabled()
    ) {
      throw new NotFoundException();
    }
  }
}
