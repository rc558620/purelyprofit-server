import {
  BadRequestException,
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
import type { StoreSubAccountRole } from '@prisma/client';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import {
  RequestAuditContext,
  type RequestAuditContextValue,
} from '../../purely-profit/auth/request-audit-context.decorator';
import { JwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { AdjustMemberBeansDto } from '../../purely-profit/member/members/dto/member-beans.dto';
import { AdjustMemberPointsDto } from '../../purely-profit/member/members/dto/member-points.dto';
import { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import {
  GetPulseAdminMembersQueryDto,
  PulseAdminMemberMembershipDto,
  PulseAdminMemberStatusDto,
  PulseAdminMemberSubAccountQuotaDto,
  PulseAdminMemberSubAccountSlotDto,
} from './dto/pulse-membership-admin-members.request.dto';
import {
  PulseAdminEmployeeCandidatesResponseDto,
  PulseAdminMembersResponseDto,
  PulseMemberDetailDto,
} from './dto/pulse-membership-admin-members.response.dto';
import { PulseMembershipService } from './membership.service';
import type {
  PulseAdminSubAccountQuotaMutationInput,
  PulseAdminSubAccountSlotMutationInput,
} from './membership.types';

@ApiTags('Pulse / Membership')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/membership/admin')
export class PulseMembershipAdminController {
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
    const memberId = this.resolveAdminMemberId(rawMemberId, dto);
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
    const memberId = this.resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.adjustAdminMemberBeans(user, memberId, dto);
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
    const memberId = this.resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.setAdminMemberMembership(user, memberId, {
      ...dto,
      auditContext,
    });
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
    const memberId = this.resolveAdminMemberId(rawMemberId, dto);
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
    const memberId = this.resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.unbanAdminMember(user, memberId);
  }

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
    const memberId = this.resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.updateAdminMemberSubAccountQuota(
      user,
      memberId,
      this.normalizeAdminSubAccountQuotaInput(dto),
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
    const memberId = this.resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.updateAdminMemberSubAccountSlot(
      user,
      memberId,
      dto as unknown as PulseAdminSubAccountSlotMutationInput,
    );
  }

  private normalizeAdminSubAccountQuotaInput(
    dto: PulseAdminMemberSubAccountQuotaDto,
  ): PulseAdminSubAccountQuotaMutationInput {
    return {
      quota: dto.quota ?? dto.subAccountQuota ?? 0,
      reason: dto.reason,
      roleSummary: dto.roleSummary?.map((item) => ({
        slot: item.slot,
        role: item.role as StoreSubAccountRole,
        status: item.status,
        isAssigned: item.isAssigned,
      })),
    };
  }

  private resolveAdminMemberId(
    rawMemberId: string,
    fallback?: unknown,
  ): number {
    const fallbackRecord = this.asAdminMutationFallback(fallback);
    const candidate =
      this.parsePositiveInt(rawMemberId) ??
      this.parsePositiveInt(fallbackRecord.memberId) ??
      this.parsePositiveInt(fallbackRecord.userId) ??
      this.parsePositiveInt(fallbackRecord.id);

    if (candidate === undefined) {
      throw new BadRequestException('缺少合法的会员 ID');
    }

    return candidate;
  }

  private asAdminMutationFallback(fallback?: unknown): {
    userId?: string;
    memberId?: string;
    id?: string;
  } {
    if (!fallback || typeof fallback !== 'object') {
      return {};
    }

    const record = fallback as Record<string, unknown>;
    return {
      userId: typeof record.userId === 'string' ? record.userId : undefined,
      memberId:
        typeof record.memberId === 'string' ? record.memberId : undefined,
      id: typeof record.id === 'string' ? record.id : undefined,
    };
  }

  private parsePositiveInt(value?: string): number | undefined {
    if (!value || value.startsWith('{') || value.endsWith('}')) {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return undefined;
    }

    return parsed;
  }
}
