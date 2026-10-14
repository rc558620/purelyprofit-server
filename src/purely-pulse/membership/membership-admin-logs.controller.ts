import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { PulseJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import { PulseMembershipService } from './membership.service';

/** 会员管理 - 积分 / 纯利豆流水 */
@ApiTags('Pulse / Membership')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/membership/admin')
export class PulseMembershipAdminLogsController {
  constructor(
    private readonly pulseMembershipService: PulseMembershipService,
  ) {}

  @Get('points/logs')
  @ApiOperation({ summary: '获取 Pulse 会员积分流水列表' })
  @ApiOkResponse({
    description: '返回 purelyPulse memberPoints 页面使用的聚合积分流水列表。',
    type: PulseAdminMemberPointsLogsResponseDto,
  })
  listAdminPointsLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    return this.pulseMembershipService.listAdminPointsLogs(user, query);
  }

  @Get('beans/logs')
  @ApiOperation({ summary: '获取 Pulse 会员纯利豆流水列表' })
  @ApiOkResponse({
    description: '返回 purelyPulse partnerBeans 页面使用的聚合纯利豆流水列表。',
    type: PulseAdminMemberBeanLogsResponseDto,
  })
  listAdminBeanLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    return this.pulseMembershipService.listAdminBeanLogs(user, query);
  }
}
