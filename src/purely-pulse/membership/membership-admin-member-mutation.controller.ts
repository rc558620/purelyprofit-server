import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import {
  RequestAuditContext,
  type RequestAuditContextValue,
} from '../../purely-profit/auth/request-audit-context.decorator';
import { PulseJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { AdjustMemberBeansDto } from '../../purely-profit/member/members/dto/member-beans.dto';
import { AdjustMemberPointsDto } from '../../purely-profit/member/members/dto/member-points.dto';
import { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import { PulseAdminMemberMembershipDto } from './dto/pulse-membership-admin-members.membership.request.dto';
import { PulseAdminMemberStatusDto } from './dto/pulse-membership-admin-members.status.request.dto';
import { resolveAdminMemberId } from './membership-admin-request.utils';
import { PulseMembershipService } from './membership.service';

/** 会员管理 - 单个会员的写操作（积分 / 纯利豆 / 等级 / 状态 / 锁价） */
@ApiTags('Pulse / Membership')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/membership/admin')
export class PulseMembershipAdminMemberMutationController {
  constructor(
    private readonly pulseMembershipService: PulseMembershipService,
  ) {}

  @Post('members/:id/points/adjust')
  @ApiOperation({ summary: 'Pulse 会员管理积分调整' })
  @ApiCreatedResponse({
    description: '调整成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  adjustAdminMemberPoints(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: AdjustMemberPointsDto,
  ): Promise<PulseMemberDetailDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.adjustAdminMemberPoints(
      user,
      memberId,
      dto,
    );
  }

  @Post('members/:id/beans/adjust')
  @ApiOperation({ summary: 'Pulse 会员管理纯利豆调整' })
  @ApiCreatedResponse({
    description: '调整成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  adjustAdminMemberBeans(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: AdjustMemberBeansDto,
  ): Promise<PulseMemberDetailDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.adjustAdminMemberBeans(
      user,
      memberId,
      dto,
    );
  }

  @Post('members/:id/membership')
  @ApiOperation({ summary: 'Pulse 会员管理设置会员等级' })
  @ApiCreatedResponse({
    description: '设置成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  setAdminMemberMembership(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberMembershipDto,
    @RequestAuditContext() auditContext: RequestAuditContextValue,
  ): Promise<PulseMemberDetailDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.setAdminMemberMembership(
      user,
      memberId,
      {
        ...dto,
        auditContext,
      },
    );
  }

  @Post('members/:id/locked-price/reset')
  @ApiOperation({ summary: 'Pulse 会员管理重置首购锁定价' })
  @ApiCreatedResponse({
    description:
      '重置后该门店所有档位的首购锁定价被清除，下一次成交（下单 / 设置会员等级）重新锁定',
    type: PulseMemberDetailDto,
  })
  resetAdminMemberLockedPrices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
  ): Promise<PulseMemberDetailDto> {
    const memberId = resolveAdminMemberId(rawMemberId);
    return this.pulseMembershipService.resetAdminMemberLockedPrices(
      user,
      memberId,
    );
  }

  @Post('members/:id/ban')
  @ApiOperation({ summary: 'Pulse 会员管理封禁' })
  @ApiCreatedResponse({
    description: '封禁成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  banAdminMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberStatusDto,
  ): Promise<PulseMemberDetailDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.banAdminMember(user, memberId, dto);
  }

  @Post('members/:id/unban')
  @ApiOperation({ summary: 'Pulse 会员管理解封' })
  @ApiCreatedResponse({
    description: '解封成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  unbanAdminMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberStatusDto,
  ): Promise<PulseMemberDetailDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.unbanAdminMember(user, memberId);
  }

  @Post('members/:id/cancel')
  @ApiOperation({ summary: 'Pulse 会员管理注销账号' })
  @ApiCreatedResponse({
    description: '注销成功后返回最新会员详情（status 为 cancelled）',
    type: PulseMemberDetailDto,
  })
  cancelAdminMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberStatusDto,
  ): Promise<PulseMemberDetailDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.cancelAdminMember(user, memberId);
  }
}
