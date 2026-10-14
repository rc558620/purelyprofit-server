import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { PulseJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PulseAdminMemberClubStatsDto } from './dto/pulse-membership-admin-club-stats.response.dto';
import { PulseAdminEmployeeCandidatesResponseDto } from './dto/pulse-membership-admin-employee.response.dto';
import { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.query.request.dto';
import { PulseAdminMembersResponseDto } from './dto/pulse-membership-admin-members.response.dto';
import { PulseAdminMemberSalesStatsDto } from './dto/pulse-membership-admin-sales-stats.response.dto';
import { PulseMembershipService } from './membership.service';

/** 会员管理 - 会员列表与会员详情读接口 */
@ApiTags('Pulse / Membership')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/membership/admin')
export class PulseMembershipAdminMembersController {
  constructor(
    private readonly pulseMembershipService: PulseMembershipService,
  ) {}

  @Get('members')
  @ApiOperation({ summary: '获取 Pulse 会员管理列表' })
  @ApiOkResponse({
    description:
      '返回目标商家的平台会员视角列表数据，供 purelyPulse member-list 页面使用。',
    type: PulseAdminMembersResponseDto,
  })
  listAdminMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    return this.pulseMembershipService.listAdminMembers(user, query);
  }

  @Get('members/:id')
  @ApiOperation({ summary: '获取 Pulse 会员管理详情' })
  @ApiOkResponse({
    description:
      '返回目标商家的单个平台会员详情，供 purelyPulse member-detail 页面使用。',
    type: PulseMemberDetailDto,
  })
  getAdminMemberDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.pulseMembershipService.getAdminMemberDetail(user, memberId);
  }

  @Get('members/:id/employees')
  @ApiOperation({ summary: '获取 Pulse 会员门店的在职员工候选列表' })
  @ApiOkResponse({
    description:
      '返回指定会员门店的在职员工列表，供 purelyPulse 会员详情页子账号槽位分配时选择员工使用。',
    type: PulseAdminEmployeeCandidatesResponseDto,
  })
  listAdminMemberEmployeeCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
  ): Promise<PulseAdminEmployeeCandidatesResponseDto> {
    return this.pulseMembershipService
      .listAdminMemberEmployeeCandidates(user, memberId)
      .then((items) => ({ items }));
  }

  @Get('members/:id/club-stats')
  @ApiOperation({ summary: '获取 Pulse 会员运营情况统计' })
  @ApiOkResponse({
    description:
      '返回目标商家在 purelyClub C 端的会员运营统计，供 purelyPulse 会员详情页「会员运营情况」弹窗使用。',
    type: PulseAdminMemberClubStatsDto,
  })
  getAdminMemberClubStats(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
  ): Promise<PulseAdminMemberClubStatsDto> {
    return this.pulseMembershipService.getAdminMemberClubStats(user, memberId);
  }

  @Get('members/:id/sales-stats')
  @ApiOperation({ summary: '获取 Pulse 会员营业详情统计' })
  @ApiOkResponse({
    description:
      '返回目标商家的销售额与利润数据（今日/本周/本月/今年/去年），供 purelyPulse 会员详情页「营业详情」弹窗使用。',
    type: PulseAdminMemberSalesStatsDto,
  })
  getAdminMemberSalesStats(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
  ): Promise<PulseAdminMemberSalesStatsDto> {
    return this.pulseMembershipService.getAdminMemberSalesStats(user, memberId);
  }
}
