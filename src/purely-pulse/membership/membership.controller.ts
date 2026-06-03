import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import type { StoreSubAccountRole } from '@prisma/client';
import type { IncomingHttpHeaders } from 'http';
import { JwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  AdjustMemberBeansDto,
  AdjustMemberPointsDto,
} from '../../purely-profit/member/members/dto/adjust-member-points.dto';
import { PurchasePlatformMembershipOrderDto } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipPlanResponseDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
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
  PulseAdminMembersResponseDto,
  PulseAdminEmployeeCandidatesResponseDto,
  PulseMemberDetailDto,
} from './dto/pulse-membership-admin-members.response.dto';
import { PulseMembershipOrderPreviewDto } from './dto/pulse-membership-orders.request.dto';
import {
  PulseMembershipOrderDetailResponseDto,
  PulseMembershipOrderPayStatusResponseDto,
  PulseMembershipOrderPreviewResponseDto,
} from './dto/pulse-membership-orders.response.dto';
import { PulseMembershipService } from './membership.service';
import type {
  PulseAdminSubAccountQuotaMutationInput,
  PulseAdminSubAccountSlotMutationInput,
} from './membership.types';

type AuthenticatedRequest = {
  user: AuthenticatedUser;
  headers?: IncomingHttpHeaders;
  ip?: string;
};

@ApiTags('Pulse / Membership')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/membership')
export class PulseMembershipController {
  constructor(
    private readonly pulseMembershipService: PulseMembershipService,
  ) {}

  // ──────────────────────────────────────────────
  // 套餐
  // ──────────────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: '获取会员套餐列表' })
  @ApiOkResponse({
    description: '返回前端订阅页面所需的套餐列表',
    type: [PlatformMembershipPlanResponseDto],
  })
  listPlans(): Promise<PlatformMembershipPlanResponseDto[]> {
    return this.pulseMembershipService.listPlans();
  }

  // ──────────────────────────────────────────────
  // 目标商家订阅中心
  // ──────────────────────────────────────────────

  @Get('center')
  @ApiOperation({ summary: '获取目标商家订阅中心兼容数据' })
  @ApiOkResponse({
    description:
      '当前返回目标商家订阅中心的旧字段结构兼容数据，默认按开发者查看目标商家订阅状态理解。',
    type: PlatformMembershipCenterResponseDto,
  })
  getCenter(
    @Req() request: AuthenticatedRequest,
  ): Promise<PlatformMembershipCenterResponseDto> {
    return this.pulseMembershipService.getCenter(this.currentUser(request));
  }

  // ──────────────────────────────────────────────
  // 目标商家订单
  // ──────────────────────────────────────────────

  @Post('orders/preview')
  @ApiOperation({ summary: '目标商家订阅下单试算兼容接口' })
  @ApiCreatedResponse({
    description: '当前按目标商家现状返回只读试算结果，不产生任何数据库写入。',
    type: PulseMembershipOrderPreviewResponseDto,
  })
  previewOrder(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PulseMembershipOrderPreviewDto,
  ): Promise<PulseMembershipOrderPreviewResponseDto> {
    return this.pulseMembershipService.previewOrder(
      this.currentUser(request),
      dto,
    );
  }

  @Post('orders')
  @ApiOperation({ summary: '为目标商家创建订阅订单的兼容接口' })
  @ApiCreatedResponse({
    description: '兼容路由：当前默认拒绝代目标商家创建订阅订单。',
    type: PurchasePlatformMembershipOrderResponseDto,
  })
  purchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    return this.pulseMembershipService.purchaseOrder(
      this.currentUser(request),
      dto,
    );
  }

  @Get('orders')
  @ApiOperation({ summary: '获取目标商家订阅订单列表的兼容接口' })
  @ApiOkResponse({
    description: '返回订单列表和汇总信息',
    type: PlatformMembershipOrdersResponseDto,
  })
  listOrders(
    @Req() request: AuthenticatedRequest,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    return this.pulseMembershipService.listOrders(this.currentUser(request));
  }

  @Get('orders/:id')
  @ApiOperation({ summary: '获取目标商家订阅订单详情的兼容接口' })
  @ApiOkResponse({
    description: '返回订单完整信息，包含价格拆解和支付时间',
    type: PulseMembershipOrderDetailResponseDto,
  })
  getOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<PulseMembershipOrderDetailResponseDto> {
    return this.pulseMembershipService.getOrder(
      this.currentUser(request),
      orderId,
    );
  }

  @Get('orders/:id/pay-status')
  @ApiOperation({ summary: '查询目标商家订阅订单支付状态的兼容接口' })
  @ApiOkResponse({
    description: '返回订单当前状态与是否已完成支付',
    type: PulseMembershipOrderPayStatusResponseDto,
  })
  getOrderPayStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<PulseMembershipOrderPayStatusResponseDto> {
    return this.pulseMembershipService.getOrderPayStatus(
      this.currentUser(request),
      orderId,
    );
  }

  // ──────────────────────────────────────────────
  // 目标商家资产流水
  // ──────────────────────────────────────────────

  @Get('points/logs')
  @ApiOperation({ summary: '获取目标商家订阅积分明细的兼容接口' })
  @ApiOkResponse({
    description: '返回积分汇总和明细列表',
    type: PlatformMembershipPointsLogsResponseDto,
  })
  listPointsLogs(
    @Req() request: AuthenticatedRequest,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    return this.pulseMembershipService.listPointsLogs(
      this.currentUser(request),
    );
  }

  @Get('beans/logs')
  @ApiOperation({ summary: '获取目标商家纯利豆明细的兼容接口' })
  @ApiOkResponse({
    description: '返回纯利豆汇总和明细列表',
    type: PlatformMembershipBeanLogsResponseDto,
  })
  listBeanLogs(
    @Req() request: AuthenticatedRequest,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    return this.pulseMembershipService.listBeanLogs(this.currentUser(request));
  }

  // ──────────────────────────────────────────────
  // 目标商家推广中心
  // ──────────────────────────────────────────────

  @Get('promo')
  @ApiOperation({ summary: '获取目标商家推广中心兼容数据' })
  @ApiOkResponse({
    description:
      '当前返回目标商家推广中心的旧字段结构兼容数据，默认按开发者查看商家推广效果理解。',
    type: PlatformMembershipPromoCenterResponseDto,
  })
  getPromoCenter(
    @Req() request: AuthenticatedRequest,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.pulseMembershipService.getPromoCenter(
      this.currentUser(request),
    );
  }

  // ──────────────────────────────────────────────
  // Pulse 管理后台：资产流水
  // ──────────────────────────────────────────────

  @Get('admin/points/logs')
  @ApiOperation({ summary: '获取 Pulse 会员积分流水列表' })
  @ApiOkResponse({
    description: '返回 purelyPulse memberPoints 页面使用的聚合积分流水列表。',
    type: PulseAdminMemberPointsLogsResponseDto,
  })
  listAdminPointsLogs(
    @Req() request: AuthenticatedRequest,
    @Query() query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    return this.pulseMembershipService.listAdminPointsLogs(
      this.currentUser(request),
      query,
    );
  }

  @Get('admin/beans/logs')
  @ApiOperation({ summary: '获取 Pulse 会员纯利豆流水列表' })
  @ApiOkResponse({
    description: '返回 purelyPulse partnerBeans 页面使用的聚合纯利豆流水列表。',
    type: PulseAdminMemberBeanLogsResponseDto,
  })
  listAdminBeanLogs(
    @Req() request: AuthenticatedRequest,
    @Query() query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    return this.pulseMembershipService.listAdminBeanLogs(
      this.currentUser(request),
      query,
    );
  }

  // ──────────────────────────────────────────────
  // Pulse 管理后台：会员查询
  // ──────────────────────────────────────────────

  @Get('admin/members')
  @ApiOperation({ summary: '获取 Pulse 会员管理列表' })
  @ApiOkResponse({
    description:
      '返回目标商家的平台会员视角列表数据，供 purelyPulse member-list 页面使用。',
    type: PulseAdminMembersResponseDto,
  })
  listAdminMembers(
    @Req() request: AuthenticatedRequest,
    @Query() query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    return this.pulseMembershipService.listAdminMembers(
      this.currentUser(request),
      query,
    );
  }

  @Get('admin/members/:id')
  @ApiOperation({ summary: '获取 Pulse 会员管理详情' })
  @ApiOkResponse({
    description:
      '返回目标商家的单个平台会员详情，供 purelyPulse member-detail 页面使用。',
    type: PulseMemberDetailDto,
  })
  getAdminMemberDetail(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.pulseMembershipService.getAdminMemberDetail(
      this.currentUser(request),
      memberId,
    );
  }

  @Get('admin/members/:id/employees')
  @ApiOperation({ summary: '获取 Pulse 会员门店的在职员工候选列表' })
  @ApiOkResponse({
    description:
      '返回指定会员门店的在职员工列表，供 purelyPulse 会员详情页子账号槽位分配时选择员工使用。',
    type: PulseAdminEmployeeCandidatesResponseDto,
  })
  listAdminMemberEmployeeCandidates(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) memberId: number,
  ): Promise<PulseAdminEmployeeCandidatesResponseDto> {
    return this.pulseMembershipService
      .listAdminMemberEmployeeCandidates(this.currentUser(request), memberId)
      .then((items) => ({ items }));
  }

  // ──────────────────────────────────────────────
  // Pulse 管理后台：会员修改
  // ──────────────────────────────────────────────

  @Post('admin/members/:id/points/adjust')
  @ApiOperation({ summary: 'Pulse 会员管理积分调整' })
  @ApiCreatedResponse({
    description: '调整成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  adjustAdminMemberPoints(
    @Req() request: AuthenticatedRequest,
    @Param('id') rawMemberId: string,
    @Body() dto: AdjustMemberPointsDto,
  ): Promise<PulseMemberDetailDto> {
    const { user, memberId } = this.resolveAdminMutationContext(
      request,
      rawMemberId,
      dto,
    );
    return this.pulseMembershipService.adjustAdminMemberPoints(
      user,
      memberId,
      dto,
    );
  }

  @Post('admin/members/:id/beans/adjust')
  @ApiOperation({ summary: 'Pulse 会员管理纯利豆调整' })
  @ApiCreatedResponse({
    description: '调整成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  adjustAdminMemberBeans(
    @Req() request: AuthenticatedRequest,
    @Param('id') rawMemberId: string,
    @Body() dto: AdjustMemberBeansDto,
  ): Promise<PulseMemberDetailDto> {
    const { user, memberId } = this.resolveAdminMutationContext(
      request,
      rawMemberId,
      dto,
    );
    return this.pulseMembershipService.adjustAdminMemberBeans(
      user,
      memberId,
      dto,
    );
  }

  @Post('admin/members/:id/membership')
  @ApiOperation({ summary: 'Pulse 会员管理设置会员等级' })
  @ApiCreatedResponse({
    description: '设置成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  setAdminMemberMembership(
    @Req() request: AuthenticatedRequest,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberMembershipDto,
  ): Promise<PulseMemberDetailDto> {
    const { user, memberId } = this.resolveAdminMutationContext(
      request,
      rawMemberId,
      dto,
    );
    return this.pulseMembershipService.setAdminMemberMembership(
      user,
      memberId,
      {
        ...dto,
        auditContext: {
          requestId: this.readHeader(request.headers, 'x-request-id'),
          userAgent: this.readHeader(request.headers, 'user-agent'),
          ip: request.ip,
        },
      },
    );
  }

  @Post('admin/members/:id/ban')
  @ApiOperation({ summary: 'Pulse 会员管理封禁' })
  @ApiCreatedResponse({
    description: '封禁成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  banAdminMember(
    @Req() request: AuthenticatedRequest,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberStatusDto,
  ): Promise<PulseMemberDetailDto> {
    const { user, memberId } = this.resolveAdminMutationContext(
      request,
      rawMemberId,
      dto,
    );
    return this.pulseMembershipService.banAdminMember(user, memberId, dto);
  }

  @Post('admin/members/:id/unban')
  @ApiOperation({ summary: 'Pulse 会员管理解封' })
  @ApiCreatedResponse({
    description: '解封成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  unbanAdminMember(
    @Req() request: AuthenticatedRequest,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberStatusDto,
  ): Promise<PulseMemberDetailDto> {
    const { user, memberId } = this.resolveAdminMutationContext(
      request,
      rawMemberId,
      dto,
    );
    return this.pulseMembershipService.unbanAdminMember(user, memberId);
  }

  @Post('admin/members/:id/sub-accounts/quota')
  @ApiOperation({ summary: 'Pulse 会员管理设置子账号额度' })
  @ApiCreatedResponse({
    description: '设置成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  updateAdminMemberSubAccountQuota(
    @Req() request: AuthenticatedRequest,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberSubAccountQuotaDto,
  ): Promise<PulseMemberDetailDto> {
    const { user, memberId } = this.resolveAdminMutationContext(
      request,
      rawMemberId,
      dto,
    );
    return this.pulseMembershipService.updateAdminMemberSubAccountQuota(
      user,
      memberId,
      this.normalizeAdminSubAccountQuotaInput(dto),
    );
  }

  @Post('admin/members/:id/sub-accounts/slots')
  @ApiOperation({ summary: 'Pulse 会员管理配置子账号槽位角色' })
  @ApiCreatedResponse({
    description: '配置成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  updateAdminMemberSubAccountSlot(
    @Req() request: AuthenticatedRequest,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberSubAccountSlotDto,
  ): Promise<PulseMemberDetailDto> {
    const { user, memberId } = this.resolveAdminMutationContext(
      request,
      rawMemberId,
      dto,
    );
    return this.pulseMembershipService.updateAdminMemberSubAccountSlot(
      user,
      memberId,
      dto as unknown as PulseAdminSubAccountSlotMutationInput,
    );
  }

  private currentUser(request: AuthenticatedRequest): AuthenticatedUser {
    return request.user;
  }

  private resolveAdminMutationContext(
    request: AuthenticatedRequest,
    rawMemberId: string,
    fallback?: unknown,
  ): { user: AuthenticatedUser; memberId: number } {
    return {
      user: this.currentUser(request),
      memberId: this.resolveAdminMemberId(rawMemberId, fallback),
    };
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

  private readHeader(
    headers: IncomingHttpHeaders | undefined,
    headerName: string,
  ): string | undefined {
    const rawValue = headers?.[headerName];
    if (typeof rawValue === 'string') {
      return rawValue;
    }
    if (Array.isArray(rawValue) && rawValue.length > 0) {
      return rawValue[0];
    }
    return undefined;
  }
}
