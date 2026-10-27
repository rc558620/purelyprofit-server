import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { PulseJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  PulseCallbackFailureListQueryDto,
  PulseClubCallbackFailureItemDto,
  PulseClubCallbackFailureListResponseDto,
  PulseClubRechargeOrderInspectDto,
  PulseResolveCallbackFailureDto,
} from './dto/pulse-club-payment-admin.dto';
import { PulseClubPaymentAdminService } from './pulse-club-payment-admin.service';

/**
 * 平台运营「支付事故人工处理」接口。
 *
 * 只放行 developer（PulseJwtAuthGuard）：这些接口能真实改变用户余额归属，
 * 绝不能落到商家端或 C 端可见面。
 */
@ApiTags('Pulse / Payments')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/payments/admin')
export class PulseClubPaymentAdminController {
  constructor(
    private readonly pulseClubPaymentAdminService: PulseClubPaymentAdminService,
  ) {}

  @Get('club/recharge/:orderNo')
  @ApiOperation({
    summary: '体检 purelyClub 充值订单（本地 + 微信侧）',
    description:
      '按订单号同时返回本地订单状态与微信侧真实交易状态，用于判断「钱到底扣没扣」，不产生任何写操作。',
  })
  @ApiOkResponse({ type: PulseClubRechargeOrderInspectDto })
  inspectRechargeOrder(
    @Param('orderNo') orderNo: string,
  ): Promise<PulseClubRechargeOrderInspectDto> {
    return this.pulseClubPaymentAdminService.inspectRechargeOrder(orderNo);
  }

  @Post('club/recharge/:orderNo/retry')
  // 补单会真实加余额，必须限流，避免误触或脚本反复重试
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: '按订单号人工补单',
    description:
      '回微信侧核对支付结果；仅当微信侧已支付且本地未落账时才真实落账，' +
      '以微信侧结果为准，避免凭空加余额。操作会写入审计日志。',
  })
  @ApiOkResponse({ type: PulseClubRechargeOrderInspectDto })
  retryRechargeOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNo') orderNo: string,
  ): Promise<PulseClubRechargeOrderInspectDto> {
    return this.pulseClubPaymentAdminService.retryRechargeOrder({
      orderNo,
      operatorId: user.id,
    });
  }

  @Get('club/callback-failures')
  @ApiOperation({
    summary: '支付回调落账死信列表',
    description:
      '列出回调重试耗尽（钱已扣、余额未到账）的订单，供运营逐条补单。',
  })
  @ApiOkResponse({ type: PulseClubCallbackFailureListResponseDto })
  async listCallbackFailures(
    @Query() query: PulseCallbackFailureListQueryDto,
  ): Promise<PulseClubCallbackFailureListResponseDto> {
    const items =
      await this.pulseClubPaymentAdminService.listCallbackFailures(query);
    return { items };
  }

  @Post('club/callback-failures/:id/resolve')
  @ApiOperation({
    summary: '标记支付回调死信已处理',
    description: '补单完成或确认无需处理后调用，记录处理人、时间与备注。',
  })
  @ApiOkResponse({ type: PulseClubCallbackFailureItemDto })
  resolveCallbackFailure(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PulseResolveCallbackFailureDto,
  ): Promise<PulseClubCallbackFailureItemDto> {
    return this.pulseClubPaymentAdminService.resolveCallbackFailure({
      id,
      status: dto.status,
      note: dto.note,
      operatorId: user.id,
    });
  }
}
