import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { JwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  GetPulseAdminPartnerApplicationsQueryDto,
  GetPulseAdminPayoutsQueryDto,
  PulseAdminApprovePartnerApplicationDto,
  PulseAdminApprovePayoutDto,
  PulseAdminPartnerApplicationsResponseDto,
  PulseAdminPayoutsResponseDto,
  PulseAdminRejectPartnerApplicationDto,
  PulseAdminRejectPayoutDto,
} from './dto/pulse-growth-admin.dto';
import type { PulseAdminPromoDetailResponse } from './growth-admin.domain';
import { PulseGrowthService } from './growth.service';

@ApiTags('Pulse - Growth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/growth/admin')
export class PulseGrowthAdminController {
  constructor(private readonly growthService: PulseGrowthService) {}

  @Get('promo-detail')
  @ApiOperation({ summary: '获取 Pulse 平台推广详情聚合数据' })
  @ApiOkResponse({
    description:
      '返回 purelyPulse promotion-detail 页面所需的地区、合伙人与趋势数据',
  })
  getPromoDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ): Promise<PulseAdminPromoDetailResponse> {
    return this.growthService.admin.promo.getDetail(user, query);
  }

  @Get('partner-applications')
  @ApiOperation({ summary: '获取 Pulse 平台合伙人申请审核列表' })
  @ApiOkResponse({
    description:
      '返回 purelyPulse partnerReview 页面所需的申请审核列表与统计信息',
    type: PulseAdminPartnerApplicationsResponseDto,
  })
  listPartnerApplications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseAdminPartnerApplicationsQueryDto,
  ): Promise<PulseAdminPartnerApplicationsResponseDto> {
    return this.growthService.admin.partnerApplications.list(user, query);
  }

  @Patch('partner-applications/:id/approve')
  @ApiOperation({ summary: 'Pulse 平台通过合伙人申请' })
  approvePartnerApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) applicationId: number,
    @Body() dto: PulseAdminApprovePartnerApplicationDto,
  ): Promise<{ success: true }> {
    return this.growthService.admin.partnerApplications.approve(
      user,
      applicationId,
      dto,
    );
  }

  @Patch('partner-applications/:id/reject')
  @ApiOperation({ summary: 'Pulse 平台拒绝合伙人申请' })
  rejectPartnerApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) applicationId: number,
    @Body() dto: PulseAdminRejectPartnerApplicationDto,
  ): Promise<{ success: true }> {
    return this.growthService.admin.partnerApplications.reject(
      user,
      applicationId,
      dto,
    );
  }

  @Get('payouts')
  @ApiOperation({ summary: '获取 Pulse 平台合伙人打款管理列表' })
  @ApiOkResponse({
    description:
      '返回 purelyPulse partnerPayout 页面所需的打款申请列表与汇总数据',
    type: PulseAdminPayoutsResponseDto,
  })
  listPayouts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseAdminPayoutsQueryDto,
  ): Promise<PulseAdminPayoutsResponseDto> {
    return this.growthService.admin.payouts.list(user, query);
  }

  @Patch('payouts/:id/approve')
  @ApiOperation({ summary: 'Pulse 平台确认合伙人打款' })
  approvePayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) payoutId: number,
    @Body() dto: PulseAdminApprovePayoutDto,
  ): Promise<{ success: true }> {
    return this.growthService.admin.payouts.approve(
      user,
      payoutId,
      dto,
    );
  }

  @Patch('payouts/:id/reject')
  @ApiOperation({ summary: 'Pulse 平台拒绝合伙人打款' })
  rejectPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) payoutId: number,
    @Body() dto: PulseAdminRejectPayoutDto,
  ): Promise<{ success: true }> {
    return this.growthService.admin.payouts.reject(user, payoutId, dto);
  }
}
