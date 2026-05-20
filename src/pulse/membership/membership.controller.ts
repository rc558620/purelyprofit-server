import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PurchasePlatformMembershipOrderDto } from '../../member/platform-membership/dto/platform-membership-query.dto';
import {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipPlanResponseDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from '../../member/platform-membership/dto/platform-membership-response.dto';
import {
  PulseMembershipOrderDetailResponseDto,
  PulseMembershipOrderPayStatusResponseDto,
  PulseMembershipOrderPreviewDto,
  PulseMembershipOrderPreviewResponseDto,
} from './dto/pulse-membership.dto';
import { PulseMembershipService } from './membership.service';

@ApiTags('PulseMembership')
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
  listPlans(): PlatformMembershipPlanResponseDto[] {
    return this.pulseMembershipService.listPlans();
  }

  // ──────────────────────────────────────────────
  // 会员中心
  // ──────────────────────────────────────────────

  @Get('center')
  @ApiOperation({ summary: '获取会员中心首页聚合数据' })
  @ApiOkResponse({
    description: '返回会员状态、权益统计、合伙人状态和纯利豆摘要',
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
  @ApiOperation({ summary: '下单试算：计算积分/纯利豆抵扣后的实付金额' })
  @ApiCreatedResponse({
    description: '返回套餐价格拆解预览，不产生任何数据库写入',
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
  @ApiOperation({ summary: '开通或续费会员并创建充值订单' })
  @ApiCreatedResponse({
    description: '创建订单成功，返回最新会员信息与充值汇总',
    type: PurchasePlatformMembershipOrderResponseDto,
  })
  purchaseOrder(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    return this.pulseMembershipService.purchaseOrder(request.user, dto);
  }

  @Get('orders')
  @ApiOperation({ summary: '获取充值记录列表与汇总' })
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
  @ApiOperation({ summary: '获取单笔充值订单详情' })
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
  @ApiOperation({ summary: '查询订单支付状态（前端轮询用）' })
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
  @ApiOperation({ summary: '获取平台会员积分明细' })
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
  @ApiOperation({ summary: '获取纯利豆明细' })
  @ApiOkResponse({
    description: '返回纯利豆汇总和明细列表',
    type: PlatformMembershipBeanLogsResponseDto,
  })
  listBeanLogs(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    return this.pulseMembershipService.listBeanLogs(request.user);
  }

  // ──────────────────────────────────────────────
  // 推广中心
  // ──────────────────────────────────────────────

  @Get('promo')
  @ApiOperation({ summary: '获取推广中心数据' })
  @ApiOkResponse({
    description: '返回推广码、等级摘要、统计和推广记录列表',
    type: PlatformMembershipPromoCenterResponseDto,
  })
  getPromoCenter(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.pulseMembershipService.getPromoCenter(request.user);
  }
}
