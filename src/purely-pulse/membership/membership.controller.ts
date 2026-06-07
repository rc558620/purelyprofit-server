import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { JwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
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
import { PulseMembershipOrderPreviewDto } from './dto/pulse-membership-orders.request.dto';
import {
  PulseMembershipOrderDetailResponseDto,
  PulseMembershipOrderPayStatusResponseDto,
  PulseMembershipOrderPreviewResponseDto,
} from './dto/pulse-membership-orders.response.dto';
import { PulseMembershipService } from './membership.service';

@ApiTags('Pulse / Membership')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/membership')
export class PulseMembershipController {
  constructor(
    private readonly pulseMembershipService: PulseMembershipService,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: '获取会员套餐列表' })
  @ApiOkResponse({
    description: '返回前端订阅页面所需的套餐列表',
    type: [PlatformMembershipPlanResponseDto],
  })
  listPlans(): Promise<PlatformMembershipPlanResponseDto[]> {
    return this.pulseMembershipService.listPlans();
  }

  @Get('center')
  @ApiOperation({ summary: '获取目标商家订阅中心兼容数据' })
  @ApiOkResponse({
    description:
      '当前返回目标商家订阅中心的旧字段结构兼容数据，默认按开发者查看目标商家订阅状态理解。',
    type: PlatformMembershipCenterResponseDto,
  })
  getCenter(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipCenterResponseDto> {
    return this.pulseMembershipService.getCenter(user);
  }

  @Post('orders/preview')
  @ApiOperation({ summary: '目标商家订阅下单试算兼容接口' })
  @ApiCreatedResponse({
    description: '当前按目标商家现状返回只读试算结果，不产生任何数据库写入。',
    type: PulseMembershipOrderPreviewResponseDto,
  })
  previewOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PulseMembershipOrderPreviewDto,
  ): Promise<PulseMembershipOrderPreviewResponseDto> {
    return this.pulseMembershipService.previewOrder(user, dto);
  }

  @Post('orders')
  @ApiOperation({ summary: '为目标商家创建订阅订单的兼容接口' })
  @ApiCreatedResponse({
    description: '兼容路由：当前默认拒绝代目标商家创建订阅订单。',
    type: PurchasePlatformMembershipOrderResponseDto,
  })
  purchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    return this.pulseMembershipService.purchaseOrder(user, dto);
  }

  @Get('orders')
  @ApiOperation({ summary: '获取目标商家订阅订单列表的兼容接口' })
  @ApiOkResponse({
    description: '返回订单列表和汇总信息',
    type: PlatformMembershipOrdersResponseDto,
  })
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    return this.pulseMembershipService.listOrders(user);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: '获取目标商家订阅订单详情的兼容接口' })
  @ApiOkResponse({
    description: '返回订单完整信息，包含价格拆解和支付时间',
    type: PulseMembershipOrderDetailResponseDto,
  })
  getOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<PulseMembershipOrderDetailResponseDto> {
    return this.pulseMembershipService.getOrder(user, orderId);
  }

  @Get('orders/:id/pay-status')
  @ApiOperation({ summary: '查询目标商家订阅订单支付状态的兼容接口' })
  @ApiOkResponse({
    description: '返回订单当前状态与是否已完成支付',
    type: PulseMembershipOrderPayStatusResponseDto,
  })
  getOrderPayStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<PulseMembershipOrderPayStatusResponseDto> {
    return this.pulseMembershipService.getOrderPayStatus(
      user,
      orderId,
    );
  }

  @Get('points/logs')
  @ApiOperation({ summary: '获取目标商家订阅积分明细的兼容接口' })
  @ApiOkResponse({
    description: '返回积分汇总和明细列表',
    type: PlatformMembershipPointsLogsResponseDto,
  })
  listPointsLogs(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    return this.pulseMembershipService.listPointsLogs(user);
  }

  @Get('beans/logs')
  @ApiOperation({ summary: '获取目标商家纯利豆明细的兼容接口' })
  @ApiOkResponse({
    description: '返回纯利豆汇总和明细列表',
    type: PlatformMembershipBeanLogsResponseDto,
  })
  listBeanLogs(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    return this.pulseMembershipService.listBeanLogs(user);
  }

  @Get('promo')
  @ApiOperation({ summary: '获取目标商家推广中心兼容数据' })
  @ApiOkResponse({
    description:
      '当前返回目标商家推广中心的旧字段结构兼容数据，默认按开发者查看商家推广效果理解。',
    type: PlatformMembershipPromoCenterResponseDto,
  })
  getPromoCenter(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.pulseMembershipService.getPromoCenter(user);
  }

}
