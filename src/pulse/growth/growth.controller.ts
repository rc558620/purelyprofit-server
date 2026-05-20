import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ApplyPlatformPartnerDto } from '../../member/platform-membership/dto/platform-membership-query.dto';
import type {
  PlatformMembershipPartnerProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
} from '../../member/platform-membership/dto/platform-membership-response.dto';
import type { ApplyWithdrawalResponseDto } from '../../member/withdrawals/dto/withdrawal-response.dto';
import {
  GetPulseEarningsLogsQueryDto,
  PulseApplyWithdrawalDto,
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountResponseDto,
  UpdatePulseWithdrawalAccountDto,
} from './dto/pulse-growth.dto';
import { PulseGrowthService } from './growth.service';

@ApiTags('Pulse - Growth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/growth')
export class PulseGrowthController {
  constructor(private readonly growthService: PulseGrowthService) {}

  // ──────────────────────────────────────────────
  // 推广中心
  // ──────────────────────────────────────────────

  @Get('promo')
  @ApiOperation({ summary: '获取推广中心数据（推广记录、统计、合伙人等级）' })
  @ApiOkResponse({ description: '返回推广中心完整数据' })
  getPromoCenter(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.growthService.getPromoCenter(request.user);
  }

  // ──────────────────────────────────────────────
  // 合伙人档案
  // ──────────────────────────────────────────────

  @Get('partner/profile')
  @ApiOperation({ summary: '获取合伙人档案（申请状态、审核历史、收益信息）' })
  @ApiOkResponse({ description: '返回合伙人档案' })
  getPartnerProfile(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.getPartnerProfile(request.user);
  }

  @Post('partner/apply')
  @ApiOperation({ summary: '申请成为合伙人' })
  @ApiCreatedResponse({ description: '申请提交成功，返回最新合伙人档案' })
  applyPartner(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.applyPartner(request.user, dto);
  }

  @Patch('partner/applications/:id/cancel')
  @ApiOperation({ summary: '撤销合伙人申请' })
  @ApiOkResponse({ description: '撤销成功，返回最新合伙人档案' })
  cancelPartnerApplication(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.cancelPartnerApplication(
      request.user,
      applicationId,
    );
  }

  // ──────────────────────────────────────────────
  // 收益
  // ──────────────────────────────────────────────

  @Get('earnings/overview')
  @ApiOperation({
    summary: '获取老板收益总览（纯利豆余额、推广统计、提现统计）',
  })
  @ApiOkResponse({
    description: '返回收益总览数据',
    type: PulseEarningsOverviewResponseDto,
  })
  getEarningsOverview(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PulseEarningsOverviewResponseDto> {
    return this.growthService.getEarningsOverview(request.user);
  }

  @Get('earnings/logs')
  @ApiOperation({ summary: '获取收益明细流水（纯利豆变动记录）' })
  @ApiOkResponse({
    description: '返回收益流水列表',
    type: PulseEarningsLogsResponseDto,
  })
  getEarningsLogs(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetPulseEarningsLogsQueryDto,
  ): Promise<PulseEarningsLogsResponseDto> {
    return this.growthService.getEarningsLogs(request.user, query.type);
  }

  // ──────────────────────────────────────────────
  // 提现账户
  // ──────────────────────────────────────────────

  @Get('withdrawals/account')
  @ApiOperation({ summary: '获取提现账户信息（收款方式、账号、当前余额）' })
  @ApiOkResponse({
    description: '返回提现账户信息',
    type: PulseWithdrawalAccountResponseDto,
  })
  getWithdrawalAccount(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PulseWithdrawalAccountResponseDto> {
    return this.growthService.getWithdrawalAccount(request.user);
  }

  @Patch('withdrawals/account')
  @ApiOperation({ summary: '更新提现账户信息（仅合伙人可操作）' })
  @ApiOkResponse({
    description: '更新成功，返回最新账户信息',
    type: PulseWithdrawalAccountResponseDto,
  })
  updateWithdrawalAccount(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: UpdatePulseWithdrawalAccountDto,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    return this.growthService.updateWithdrawalAccount(request.user, dto);
  }

  @Post('withdrawals/apply')
  @ApiOperation({ summary: '申请提现（从当前合伙人账户提现纯利豆）' })
  @ApiCreatedResponse({ description: '申请成功，返回提现记录与当前概览' })
  applyWithdrawal(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: PulseApplyWithdrawalDto,
  ): Promise<ApplyWithdrawalResponseDto> {
    return this.growthService.applyWithdrawal(request.user, dto.beanAmount);
  }
}
