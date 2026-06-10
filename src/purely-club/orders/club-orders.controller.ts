import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubOrdersService } from './club-orders.service';
import {
  ClubOrderStatusResponseDto,
  ClubServiceOrderResponseDto,
  CreateClubServiceOrderDto,
} from './dto/club-order.dto';

@ApiTags('Club / Orders')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@Controller('club/orders')
export class ClubOrdersController {
  constructor(private readonly clubOrdersService: ClubOrdersService) {}

  @Post('service')
  @ApiOperation({
    summary: '创建 purely-club 服务购买订单',
    description:
      '基于当前 purely-club 用户的当前门店和服务商品，创建一笔待支付的服务购买订单草稿，并返回微信支付参数。',
  })
  @ApiCreatedResponse({ type: ClubServiceOrderResponseDto })
  createServiceOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClubServiceOrderDto,
  ): Promise<ClubServiceOrderResponseDto> {
    return this.clubOrdersService.createServiceOrder(user, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: '查询 purely-club 服务订单状态',
    description:
      '返回当前 purely-club 用户指定服务订单的状态，并补充支付流水号、回调接收时间、确认来源与状态说明，供前端仅靠查单完成支付联调收口。',
  })
  @ApiOkResponse({ type: ClubOrderStatusResponseDto })
  getOrderStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') orderId: string,
  ): Promise<ClubOrderStatusResponseDto> {
    return this.clubOrdersService.getOrderStatus(user, orderId);
  }

  @Post(':id/confirm-paid')
  @ApiOperation({
    summary: '确认 purely-club 服务订单支付成功并真实落账（开发态兜底）',
    description:
      '仅在开发态作为联调兜底保留；生产链路应由微信支付回调驱动真实落账，前端默认不再调用该接口。',
  })
  @ApiOkResponse({ type: ClubServiceOrderResponseDto })
  confirmOrderPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') orderId: string,
  ): Promise<ClubServiceOrderResponseDto> {
    return this.clubOrdersService.confirmOrderPaid(user, orderId);
  }
}
