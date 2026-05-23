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
import {
  GetPulseAdminMembersQueryDto,
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberMembershipDto,
  PulseAdminMemberPointsLogsResponseDto,
  PulseAdminMemberStatusDto,
  PulseAdminMembersResponseDto,
  PulseMemberDetailDto,
  PulseMembershipOrderDetailResponseDto,
  PulseMembershipOrderPayStatusResponseDto,
  PulseMembershipOrderPreviewDto,
  PulseMembershipOrderPreviewResponseDto,
} from './dto/pulse-membership.dto';
import { PulseMembershipService } from './membership.service';

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
  // 目标商家订阅兼容接口
  // ──────────────────────────────────────────────

  @Get('center')
  @ApiOperation({ summary: '获取目标商家订阅中心兼容数据' })
  @ApiOkResponse({
    description: '当前返回目标商家订阅中心的旧字段结构兼容数据，默认按开发者查看目标商家订阅状态理解。',
    type: PlatformMembershipCenterResponseDto,
  })
  getCenter(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipCenterResponseDto> {
    return this.pulseMembershipService.getCenter(request.user);
  }

  // ──────────────────────────────────────────────
  // 订单 —— 试算
  // ──────────────────────────────────────────────

  @Post('orders/preview')
  @ApiOperation({ summary: '目标商家订阅下单试算兼容接口' })
  @ApiCreatedResponse({
    description: '当前按目标商家现状返回只读试算结果，不产生任何数据库写入。',
    type: PulseMembershipOrderPreviewResponseDto,
  })
  previewOrder(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: PulseMembershipOrderPreviewDto,
  ): Promise<PulseMembershipOrderPreviewResponseDto> {
    return this.pulseMembershipService.previewOrder(request.user, dto);
  }

  // ──────────────────────────────────────────────
  // 订单 —— 下单 & 列表
  // ──────────────────────────────────────────────

  @Post('orders')
  @ApiOperation({ summary: '为目标商家创建订阅订单的兼容接口' })
  @ApiCreatedResponse({
    description: '兼容路由：当前默认拒绝代目标商家创建订阅订单。',
    type: PurchasePlatformMembershipOrderResponseDto,
  })
  purchaseOrder(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    return this.pulseMembershipService.purchaseOrder(request.user, dto);
  }

  @Get('orders')
  @ApiOperation({ summary: '获取目标商家订阅订单列表的兼容接口' })
  @ApiOkResponse({
    description: '返回订单列表和汇总信息',
    type: PlatformMembershipOrdersResponseDto,
  })
  listOrders(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipOrdersResponseDto> {
    return this.pulseMembershipService.listOrders(request.user);
  }

  // ──────────────────────────────────────────────
  // 订单 —— 详情 & 支付状态
  // ──────────────────────────────────────────────

  @Get('orders/:id')
  @ApiOperation({ summary: '获取目标商家订阅订单详情的兼容接口' })
  @ApiOkResponse({
    description: '返回订单完整信息，包含价格拆解和支付时间',
    type: PulseMembershipOrderDetailResponseDto,
  })
  getOrder(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<PulseMembershipOrderDetailResponseDto> {
    return this.pulseMembershipService.getOrder(request.user, orderId);
  }

  @Get('orders/:id/pay-status')
  @ApiOperation({ summary: '查询目标商家订阅订单支付状态的兼容接口' })
  @ApiOkResponse({
    description: '返回订单当前状态与是否已完成支付',
    type: PulseMembershipOrderPayStatusResponseDto,
  })
  getOrderPayStatus(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<PulseMembershipOrderPayStatusResponseDto> {
    return this.pulseMembershipService.getOrderPayStatus(request.user, orderId);
  }

  // ──────────────────────────────────────────────
  // 积分 & 纯利豆明细
  // ──────────────────────────────────────────────

  @Get('points/logs')
  @ApiOperation({ summary: '获取目标商家订阅积分明细的兼容接口' })
  @ApiOkResponse({
    description: '返回积分汇总和明细列表',
    type: PlatformMembershipPointsLogsResponseDto,
  })
  listPointsLogs(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    return this.pulseMembershipService.listPointsLogs(request.user);
  }

  @Get('beans/logs')
  @ApiOperation({ summary: '获取目标商家纯利豆明细的兼容接口' })
  @ApiOkResponse({
    description: '返回纯利豆汇总和明细列表',
    type: PlatformMembershipBeanLogsResponseDto,
  })
  listBeanLogs(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    return this.pulseMembershipService.listBeanLogs(request.user);
  }

  @Get('admin/points/logs')
  @ApiOperation({ summary: '获取 Pulse 会员积分流水列表' })
  @ApiOkResponse({
    description: '返回 purelyPulse memberPoints 页面使用的聚合积分流水列表。',
    type: PulseAdminMemberPointsLogsResponseDto,
  })
  listAdminPointsLogs(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    return this.pulseMembershipService.listAdminPointsLogs(request.user);
  }

  @Get('admin/beans/logs')
  @ApiOperation({ summary: '获取 Pulse 会员纯利豆流水列表' })
  @ApiOkResponse({
    description: '返回 purelyPulse partnerBeans 页面使用的聚合纯利豆流水列表。',
    type: PulseAdminMemberBeanLogsResponseDto,
  })
  listAdminBeanLogs(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    return this.pulseMembershipService.listAdminBeanLogs(request.user);
  }

  // ──────────────────────────────────────────────
  // 目标商家推广兼容接口
  // ──────────────────────────────────────────────

  @Get('promo')
  @ApiOperation({ summary: '获取目标商家推广中心兼容数据' })
  @ApiOkResponse({
    description: '当前返回目标商家推广中心的旧字段结构兼容数据，默认按开发者查看商家推广效果理解。',
    type: PlatformMembershipPromoCenterResponseDto,
  })
  getPromoCenter(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.pulseMembershipService.getPromoCenter(request.user);
  }

  @Get('admin/members')
  @ApiOperation({ summary: '获取 Pulse 会员管理列表' })
  @ApiOkResponse({
    description: '返回目标商家的平台会员视角列表数据，供 purelyPulse member-list 页面使用。',
    type: PulseAdminMembersResponseDto,
  })
  listAdminMembers(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    return this.pulseMembershipService.listAdminMembers(request.user, query);
  }

  @Get('admin/members/:id')
  @ApiOperation({ summary: '获取 Pulse 会员管理详情' })
  @ApiOkResponse({
    description: '返回目标商家的单个平台会员详情，供 purelyPulse member-detail 页面使用。',
    type: PulseMemberDetailDto,
  })
  getAdminMemberDetail(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.pulseMembershipService.getAdminMemberDetail(request.user, memberId);
  }

  @Post('admin/members/:id/points/adjust')
  @ApiOperation({ summary: 'Pulse 会员管理积分调整' })
  @ApiCreatedResponse({
    description: '调整成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  adjustAdminMemberPoints(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') rawMemberId: string,
    @Body() dto: AdjustMemberPointsDto,
  ): Promise<PulseMemberDetailDto> {
    return this.pulseMembershipService.adjustAdminMemberPoints(
      request.user,
      this.resolveAdminMemberId(rawMemberId, dto),
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
    @Req() request: { user: AuthenticatedUser },
    @Param('id') rawMemberId: string,
    @Body() dto: AdjustMemberBeansDto,
  ): Promise<PulseMemberDetailDto> {
    return this.pulseMembershipService.adjustAdminMemberBeans(
      request.user,
      this.resolveAdminMemberId(rawMemberId, dto),
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
    @Req() request: { user: AuthenticatedUser },
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberMembershipDto,
  ): Promise<PulseMemberDetailDto> {
    return this.pulseMembershipService.setAdminMemberMembership(
      request.user,
      this.resolveAdminMemberId(rawMemberId, dto),
      dto,
    );
  }

  @Post('admin/members/:id/ban')
  @ApiOperation({ summary: 'Pulse 会员管理封禁' })
  @ApiCreatedResponse({
    description: '封禁成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  banAdminMember(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberStatusDto,
  ): Promise<PulseMemberDetailDto> {
    return this.pulseMembershipService.banAdminMember(
      request.user,
      this.resolveAdminMemberId(rawMemberId, dto),
      dto,
    );
  }

  @Post('admin/members/:id/unban')
  @ApiOperation({ summary: 'Pulse 会员管理解封' })
  @ApiCreatedResponse({
    description: '解封成功后返回最新会员详情',
    type: PulseMemberDetailDto,
  })
  unbanAdminMember(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberStatusDto,
  ): Promise<PulseMemberDetailDto> {
    return this.pulseMembershipService.unbanAdminMember(
      request.user,
      this.resolveAdminMemberId(rawMemberId, dto),
    );
  }

  private resolveAdminMemberId(
    rawMemberId: string,
    fallback?: { userId?: string; memberId?: string; id?: string },
  ): number {
    const candidate =
      this.parsePositiveInt(rawMemberId) ??
      this.parsePositiveInt(fallback?.memberId) ??
      this.parsePositiveInt(fallback?.userId) ??
      this.parsePositiveInt(fallback?.id);

    if (candidate === undefined) {
      throw new BadRequestException('缺少合法的会员 ID');
    }

    return candidate;
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
