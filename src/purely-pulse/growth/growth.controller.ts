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
import { JwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ApplyPlatformPartnerDto } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type {
  PlatformMembershipPartnerProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import type { ApplyWithdrawalResponseDto } from '../../purely-profit/member/withdrawals/dto/withdrawal-response.dto';
import {
  GetPulseAdminPartnerApplicationsQueryDto,
  GetPulseAdminPayoutsQueryDto,
  GetPulseEarningsLogsQueryDto,
  PulseAdminApprovePartnerApplicationDto,
  PulseAdminApprovePayoutDto,
  PulseAdminPartnerApplicationsResponseDto,
  PulseAdminPayoutsResponseDto,
  PulseAdminRejectPartnerApplicationDto,
  PulseAdminRejectPayoutDto,
  PulseApplyWithdrawalDto,
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountResponseDto,
  UpdatePulseWithdrawalAccountDto,
} from './dto/pulse-growth.dto';
import {
  PulseGrowthService,
  type PulseAdminPromoDetailResponse,
} from './growth.service';

@ApiTags('Pulse - Growth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/growth')
export class PulseGrowthController {
  constructor(private readonly growthService: PulseGrowthService) {}

  // ──────────────────────────────────────────────
  // 目标商家增长兼容接口
  // ──────────────────────────────────────────────

  @Get('promo')
  @ApiOperation({ summary: '获取目标商家推广中心兼容数据' })
  @ApiOkResponse({ description: '当前仍返回目标商家推广中心的兼容数据' })
  getPromoCenter(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.growthService.getPromoCenter(request.user);
  }

  @Get('admin/promo-detail')
  @ApiOperation({ summary: '获取 Pulse 平台推广详情聚合数据' })
  @ApiOkResponse({ description: '返回 purelyPulse promotion-detail 页面所需的地区、合伙人与趋势数据' })
  getAdminPromoDetail(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: Record<string, unknown>,
  ): Promise<PulseAdminPromoDetailResponse> {
    return this.growthService.getAdminPromoDetail(request.user, query);
  }

  // ──────────────────────────────────────────────
  // 目标商家合伙人兼容接口
  // ──────────────────────────────────────────────

  @Get('partner/profile')
  @ApiOperation({ summary: '获取目标商家合伙人档案的兼容接口' })
  @ApiOkResponse({ description: '当前仍返回目标商家合伙人档案的兼容数据' })
  getPartnerProfile(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.getPartnerProfile(request.user);
  }

  @Get('admin/partner-applications')
  @ApiOperation({ summary: '获取 Pulse 平台合伙人申请审核列表' })
  @ApiOkResponse({
    description: '返回 purelyPulse partnerReview 页面所需的申请审核列表与统计信息',
    type: PulseAdminPartnerApplicationsResponseDto,
  })
  listAdminPartnerApplications(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetPulseAdminPartnerApplicationsQueryDto,
  ): Promise<PulseAdminPartnerApplicationsResponseDto> {
    return this.growthService.listAdminPartnerApplications(request.user, query);
  }

  @Patch('admin/partner-applications/:id/approve')
  @ApiOperation({ summary: 'Pulse 平台通过合伙人申请' })
  approveAdminPartnerApplication(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
    @Body() dto: PulseAdminApprovePartnerApplicationDto,
  ): Promise<{ success: true }> {
    return this.growthService.approveAdminPartnerApplication(
      request.user,
      applicationId,
      dto,
    );
  }

  @Patch('admin/partner-applications/:id/reject')
  @ApiOperation({ summary: 'Pulse 平台拒绝合伙人申请' })
  rejectAdminPartnerApplication(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
    @Body() dto: PulseAdminRejectPartnerApplicationDto,
  ): Promise<{ success: true }> {
    return this.growthService.rejectAdminPartnerApplication(
      request.user,
      applicationId,
      dto,
    );
  }

  @Post('partner/apply')
  @ApiOperation({ summary: '目标商家申请合伙人的兼容接口' })
  @ApiCreatedResponse({ description: '兼容路由：当前默认拒绝代目标商家提交合伙人申请' })
  applyPartner(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.applyPartner(request.user, dto);
  }

  @Patch('partner/applications/:id/cancel')
  @ApiOperation({ summary: '撤销目标商家合伙人申请的兼容接口' })
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
  // 目标商家收益兼容接口
  // ──────────────────────────────────────────────

  @Get('earnings/overview')
  @ApiOperation({
    summary: '获取目标商家收益总览的兼容接口',
  })
  @ApiOkResponse({
    description: '当前仍返回目标商家收益中心的兼容数据',
    type: PulseEarningsOverviewResponseDto,
  })
  getEarningsOverview(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PulseEarningsOverviewResponseDto> {
    return this.growthService.getEarningsOverview(request.user);
  }

  @Get('earnings/logs')
  @ApiOperation({ summary: '获取目标商家收益流水的兼容接口' })
  @ApiOkResponse({
    description: '当前仍返回目标商家收益流水的兼容数据',
    type: PulseEarningsLogsResponseDto,
  })
  getEarningsLogs(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetPulseEarningsLogsQueryDto,
  ): Promise<PulseEarningsLogsResponseDto> {
    return this.growthService.getEarningsLogs(request.user, query.type);
  }

  @Get('admin/payouts')
  @ApiOperation({ summary: '获取 Pulse 平台合伙人打款管理列表' })
  @ApiOkResponse({
    description: '返回 purelyPulse partnerPayout 页面所需的打款申请列表与汇总数据',
    type: PulseAdminPayoutsResponseDto,
  })
  listAdminPayouts(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetPulseAdminPayoutsQueryDto,
  ): Promise<PulseAdminPayoutsResponseDto> {
    return this.growthService.listAdminPayouts(request.user, query);
  }

  @Patch('admin/payouts/:id/approve')
  @ApiOperation({ summary: 'Pulse 平台确认合伙人打款' })
  approveAdminPayout(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) payoutId: number,
    @Body() dto: PulseAdminApprovePayoutDto,
  ): Promise<{ success: true }> {
    return this.growthService.approveAdminPayout(request.user, payoutId, dto);
  }

  @Patch('admin/payouts/:id/reject')
  @ApiOperation({ summary: 'Pulse 平台拒绝合伙人打款' })
  rejectAdminPayout(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) payoutId: number,
    @Body() dto: PulseAdminRejectPayoutDto,
  ): Promise<{ success: true }> {
    return this.growthService.rejectAdminPayout(request.user, payoutId, dto);
  }

  // ──────────────────────────────────────────────
  // 目标商家提现兼容接口
  // ──────────────────────────────────────────────

  @Get('withdrawals/account')
  @ApiOperation({ summary: '获取目标商家提现账户的兼容接口' })
  @ApiOkResponse({
    description: '当前仍返回目标商家提现账户的兼容数据',
    type: PulseWithdrawalAccountResponseDto,
  })
  getWithdrawalAccount(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PulseWithdrawalAccountResponseDto> {
    return this.growthService.getWithdrawalAccount(request.user);
  }

  @Patch('withdrawals/account')
  @ApiOperation({ summary: '更新目标商家提现账户的兼容接口' })
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
  @ApiOperation({ summary: '目标商家申请提现的兼容接口' })
  @ApiCreatedResponse({ description: '兼容路由：当前默认拒绝代目标商家发起提现申请' })
  applyWithdrawal(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: PulseApplyWithdrawalDto,
  ): Promise<ApplyWithdrawalResponseDto> {
    return this.growthService.applyWithdrawal(request.user, dto.beanAmount);
  }
}
