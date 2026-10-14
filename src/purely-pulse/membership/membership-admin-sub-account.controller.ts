import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { PulseJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import {
  PulseAdminMemberSubAccountQuotaDto,
  PulseAdminMemberSubAccountSlotDto,
} from './dto/pulse-membership-admin-members.sub-account.request.dto';
import {
  normalizeAdminSubAccountQuotaInput,
  resolveAdminMemberId,
} from './membership-admin-request.utils';
import { PulseMembershipService } from './membership.service';
import type { PulseAdminSubAccountSlotMutationInput } from './membership.types';

/** 会员管理 - 子账号额度与槽位配置 */
@ApiTags('Pulse / Membership')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/membership/admin')
export class PulseMembershipAdminSubAccountController {
  constructor(
    private readonly pulseMembershipService: PulseMembershipService,
  ) {}

  @Post('members/:id/sub-accounts/quota')
  @ApiOperation({ summary: 'Pulse 会员管理设置子账号额度' })
  @ApiCreatedResponse({
    description: '设置成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  updateAdminMemberSubAccountQuota(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberSubAccountQuotaDto,
  ): Promise<PulseMemberDetailDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.updateAdminMemberSubAccountQuota(
      user,
      memberId,
      normalizeAdminSubAccountQuotaInput(dto),
    );
  }

  @Post('members/:id/sub-accounts/slots')
  @ApiOperation({ summary: 'Pulse 会员管理配置子账号槽位角色' })
  @ApiCreatedResponse({
    description: '配置成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  updateAdminMemberSubAccountSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberSubAccountSlotDto,
  ): Promise<PulseMemberDetailDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.updateAdminMemberSubAccountSlot(
      user,
      memberId,
      dto as unknown as PulseAdminSubAccountSlotMutationInput,
    );
  }
}
