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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../purely-profit/auth/current-user.decorator';
import { PulseJwtAuthGuard } from '../../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../purely-profit/auth/strategies/jwt.strategy';
import {
  GetPulseAdminSmsAccountsQueryDto,
  GetPulseAdminSmsBroadcastsQueryDto,
  GrantPulseAdminSmsBalanceDto,
  RefundPulseAdminSmsBroadcastDto,
} from './dto/pulse-sms.request.dto';
import {
  PulseAdminSmsAccountDto,
  PulseAdminSmsAccountsResponseDto,
  PulseAdminSmsBroadcastRefundResultDto,
  PulseAdminSmsBroadcastsResponseDto,
} from './dto/pulse-sms.response.dto';
import { PulseSmsService } from './pulse-sms.service';

/** 群发短信管理 - 门店短信账户与平台赠送 */
@ApiTags('Pulse / Marketing')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/marketing/admin/sms')
export class PulseSmsController {
  constructor(private readonly pulseSmsService: PulseSmsService) {}

  @Get('accounts')
  @ApiOperation({ summary: '获取 Pulse 门店短信账户列表' })
  @ApiOkResponse({
    description:
      '返回当前用户可访问门店的短信账户现状（可用余额 / 累计充值 / 累计消费 / 累计发送条数），' +
      '供 purelyPulse 群发短信页面展示。从未发过短信的门店没有账户行，按零余额返回。',
    type: PulseAdminSmsAccountsResponseDto,
  })
  listAdminSmsAccounts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseAdminSmsAccountsQueryDto,
  ): Promise<PulseAdminSmsAccountsResponseDto> {
    return this.pulseSmsService.listAdminSmsAccounts(user, query);
  }

  @Post('accounts/:storeId/grant')
  @ApiOperation({ summary: 'Pulse 平台赠送 / 回收门店短信余额' })
  @ApiCreatedResponse({
    description:
      '按增量调整目标门店的短信余额（正数赠送 / 负数回收，余额不会低于 0）' +
      '并写入一条钱包流水（grant / admin_adjust）。' +
      '调整后 purelyProfit 短信余额页与下一次群发询价立即按新余额生效。',
    type: PulseAdminSmsAccountDto,
  })
  grantAdminSmsBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Body() dto: GrantPulseAdminSmsBalanceDto,
  ): Promise<PulseAdminSmsAccountDto> {
    return this.pulseSmsService.grantAdminSmsBalance(user, storeId, dto);
  }

  @Get('accounts/:storeId/broadcasts')
  @ApiOperation({
    summary: 'Pulse 门店群发任务列表',
    description:
      '查看门店的历史群发与投递结果（成功 / 失败人数、已退费金额）。' +
      '群发失败不自动退费，运营据此人工核实后调用退费接口。',
  })
  @ApiOkResponse({ type: PulseAdminSmsBroadcastsResponseDto })
  listAdminSmsBroadcasts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query() query: GetPulseAdminSmsBroadcastsQueryDto,
  ): Promise<PulseAdminSmsBroadcastsResponseDto> {
    return this.pulseSmsService.listAdminSmsBroadcasts(user, storeId, query);
  }

  @Post('accounts/:storeId/broadcasts/:broadcastId/refund')
  @ApiOperation({
    summary: 'Pulse 群发失败退费',
    description:
      '把未送达部分（失败条数 × 单价）退回门店短信余额并写 refund 流水。' +
      '只允许失败 / 部分失败的任务，且每个任务只能退一次。',
  })
  @ApiCreatedResponse({ type: PulseAdminSmsBroadcastRefundResultDto })
  refundAdminSmsBroadcast(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Param('broadcastId') broadcastId: string,
    @Body() dto: RefundPulseAdminSmsBroadcastDto,
  ): Promise<PulseAdminSmsBroadcastRefundResultDto> {
    return this.pulseSmsService.refundAdminSmsBroadcast(
      user,
      storeId,
      broadcastId,
      dto,
    );
  }
}
