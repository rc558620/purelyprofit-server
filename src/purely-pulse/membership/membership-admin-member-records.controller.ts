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
import { GetPulseAdminMemberRecordsQueryDto } from './dto/pulse-membership-admin-member-records.request.dto';
import { PulseAdminMemberRecordsResponseDto } from './dto/pulse-membership-admin-member-records.response.dto';
import { PulseMembershipService } from './membership.service';

/** 会员管理 - 跨会员记录时间轴 */
@ApiTags('Pulse / Membership')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/membership/admin')
export class PulseMembershipAdminMemberRecordsController {
  constructor(
    private readonly pulseMembershipService: PulseMembershipService,
  ) {}

  @Get('member-records')
  @ApiOperation({ summary: '获取 Pulse 会员记录管理列表' })
  @ApiOkResponse({
    description:
      '返回 purelyPulse member-records 页面使用的跨会员记录时间轴：充值记录、会员等级设置记录、调整续费记录、子账号设置记录。',
    type: PulseAdminMemberRecordsResponseDto,
  })
  listAdminMemberRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseAdminMemberRecordsQueryDto,
  ): Promise<PulseAdminMemberRecordsResponseDto> {
    return this.pulseMembershipService.listAdminMemberRecords(user, query);
  }
}
