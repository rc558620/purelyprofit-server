import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PROFIT_PAYMENT_MODE_DEV_TOKEN_HEADER } from './profit-payment-mode.constants';
import { ProfitPaymentModeService } from './profit-payment-mode.service';
import { ProfitPaymentModeDevGuard } from './guards/profit-payment-mode-dev.guard';
import { ProfitPaymentModeResponseDto } from './dto/profit-payment-mode-response.dto';
import { UpdateProfitPaymentModeDto } from './dto/update-profit-payment-mode.dto';

/**
 * 商家端支付模式（测试 / 真实）调试开关接口。
 *
 * 仅在非生产环境可用：生产环境一律伪装为路由不存在（404，由
 * `ProfitPaymentModeDevGuard` 在参数校验前统一拦截），
 * 切换请求还需通过服务端配置的访问令牌校验，避免测试环境公网可达时被任意切换，
 * 出现「本以为是测试、实际上是真实扣款」的资金事故。
 */
@ApiTags('Profit / Payments · 调试')
@UseGuards(ProfitPaymentModeDevGuard)
@Controller('profit/dev')
export class ProfitPaymentModeController {
  private readonly logger = new Logger(ProfitPaymentModeController.name);

  constructor(
    private readonly profitPaymentModeService: ProfitPaymentModeService,
  ) {}

  // 注意：@nestjs/throttler v5+ 的 ttl 单位是**毫秒**，写成 60 只有 60ms 窗口，等于完全没限流
  @Get('payment-mode')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: '查询当前支付模式',
    description:
      '仅供本地 / 测试环境调试使用，生产环境不可用。返回当前是测试模式（跳过微信扣款）还是真实支付模式。',
  })
  @ApiOkResponse({
    description: '当前支付模式',
    type: ProfitPaymentModeResponseDto,
  })
  async getPaymentMode(): Promise<ProfitPaymentModeResponseDto> {
    return this.buildResponse();
  }

  @Post('payment-mode')
  @HttpCode(HttpStatus.OK)
  // 同上：单位是毫秒。切换开关是敏感操作，10 次/分钟已足够调试
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: '切换支付模式',
    description:
      '在测试模式与真实支付模式之间切换，需在 `x-payment-dev-token` 请求头携带服务端配置的访问令牌。' +
      '切换结果 12 小时后自动回落为配置默认模式，避免长期遗忘在真实扣款状态。' +
      '配置默认模式为真实支付时不允许切换到测试模式（返回 409），需先在配置中打开 PROFIT_MANUAL_PAID_ENABLED。',
  })
  @ApiOkResponse({
    description: '切换后的支付模式',
    type: ProfitPaymentModeResponseDto,
  })
  async updatePaymentMode(
    @Body() dto: UpdateProfitPaymentModeDto,
    @Headers(PROFIT_PAYMENT_MODE_DEV_TOKEN_HEADER) devToken?: string,
  ): Promise<ProfitPaymentModeResponseDto> {
    if (!this.profitPaymentModeService.isDevTokenValid(devToken)) {
      this.logger.warn('[Profit 支付模式] 切换请求令牌校验失败，已拒绝');
      throw new UnauthorizedException('支付模式切换令牌无效或未配置');
    }

    await this.profitPaymentModeService.setMode(dto.mode);
    return this.buildResponse();
  }

  /** 组装支付模式响应。 */
  private async buildResponse(): Promise<ProfitPaymentModeResponseDto> {
    return {
      mode: await this.profitPaymentModeService.getMode(),
      switchEnabled: this.profitPaymentModeService.isSwitchEnabled(),
      devTokenConfigured: this.profitPaymentModeService.isDevTokenConfigured(),
      skipPaymentAllowed:
        await this.profitPaymentModeService.isSkipPaymentAllowed(),
      ttlSeconds: this.profitPaymentModeService.getModeTtlSeconds(),
    };
  }
}
