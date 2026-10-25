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
import { CLUB_PAYMENT_MODE_DEV_TOKEN_HEADER } from './club-payment-mode.constants';
import { ClubPaymentModeService } from './club-payment-mode.service';
import { PaymentModeResponseDto } from './dto/payment-mode-response.dto';
import { UpdatePaymentModeDto } from './dto/update-payment-mode.dto';

/**
 * 支付模式（测试 / 真实）调试开关接口。
 *
 * 仅在非生产环境可用：生产环境一律伪装为路由不存在（404），
 * 切换请求还需通过服务端配置的访问令牌校验，避免测试环境公网可达时被任意切换，
 * 导致「本以为是测试、实际是真实扣款」的资金事故。
 */
@ApiTags('Club / Payments · 调试')
@Controller('club/dev')
export class ClubPaymentModeController {
  private readonly logger = new Logger(ClubPaymentModeController.name);

  constructor(
    private readonly clubPaymentModeService: ClubPaymentModeService,
  ) {}

  // 注意：@nestjs/throttler v5+ 的 ttl 单位是**毫秒**。
  // 写成 60 只有 60ms 窗口，等于完全没限流。
  @Get('payment-mode')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: '查询当前支付模式',
    description:
      '仅供本地 / 测试环境调试使用，生产环境不可用。返回当前是测试模式（跳过微信扣款）还是真实支付模式。',
  })
  @ApiOkResponse({ description: '当前支付模式', type: PaymentModeResponseDto })
  async getPaymentMode(): Promise<PaymentModeResponseDto> {
    this.ensureDevAvailable();
    return this.buildResponse();
  }

  @Post('payment-mode')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: '切换支付模式',
    description:
      '在测试模式与真实支付模式之间切换，需在 `x-payment-dev-token` 请求头携带服务端配置的访问令牌。' +
      '切换结果 12 小时后自动回落为配置默认模式，避免长期遗忘在真实扣款状态。',
  })
  @ApiOkResponse({
    description: '切换后的支付模式',
    type: PaymentModeResponseDto,
  })
  async updatePaymentMode(
    @Body() dto: UpdatePaymentModeDto,
    @Headers(CLUB_PAYMENT_MODE_DEV_TOKEN_HEADER) devToken?: string,
  ): Promise<PaymentModeResponseDto> {
    this.ensureDevAvailable();

    if (!this.clubPaymentModeService.isDevTokenValid(devToken)) {
      this.logger.warn('[支付模式] 切换请求令牌校验失败，已拒绝');
      throw new UnauthorizedException('支付模式切换令牌无效或未配置');
    }

    await this.clubPaymentModeService.setMode(dto.mode);
    return this.buildResponse();
  }

  /** 组装支付模式响应。 */
  private async buildResponse(): Promise<PaymentModeResponseDto> {
    return {
      mode: await this.clubPaymentModeService.getMode(),
      switchEnabled: this.clubPaymentModeService.isSwitchEnabled(),
      devTokenConfigured: this.clubPaymentModeService.isDevTokenConfigured(),
      manualConfirmPaidAllowed:
        await this.clubPaymentModeService.isManualConfirmPaidAllowed(),
      ttlSeconds: this.clubPaymentModeService.getModeTtlSeconds(),
    };
  }

  /**
   * 生产环境或已关闭切换开关时，伪装为路由不存在。
   * 用 404 而非 403，避免向外部暴露该调试接口的存在。
   */
  private ensureDevAvailable(): void {
    if (
      this.clubPaymentModeService.isProduction() ||
      !this.clubPaymentModeService.isSwitchEnabled()
    ) {
      throw new NotFoundException();
    }
  }
}
