import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import { ClubCurrentContextInterceptor } from '../stores/club-current-context.interceptor';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CurrentClubContext } from '../stores/current-club-context.decorator';
import { ClubRechargeService } from './club-recharge.service';
import {
  ClubRechargeOrderResponseDto,
  ClubRechargeOrderStatusQueryDto,
  ClubRechargePackagesResponseDto,
  CreateClubRechargeOrderDto,
  ListClubRechargePackagesQueryDto,
} from './dto/club-recharge.dto';

@ApiTags('Club / Recharge')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/recharge')
export class ClubRechargeController {
  constructor(private readonly clubRechargeService: ClubRechargeService) {}

  @Get('packages')
  @ApiOperation({
    summary: '获取 purely-club 当前门店充值套餐列表',
    description:
      '返回当前登录 purely-club 用户当前门店下的充值套餐；优先使用有效充赠活动，没有配置时回落到默认展示套餐。',
  })
  @ApiOkResponse({ type: ClubRechargePackagesResponseDto })
  listPackages(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Query() query: ListClubRechargePackagesQueryDto,
  ): Promise<ClubRechargePackagesResponseDto> {
    return this.clubRechargeService.listPackages(currentContext, query);
  }

  @Post('orders')
  // 下单会调用微信 JSAPI 预支付，无限制时会被刷单打爆商户接口
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({
    summary: '创建 purely-club 充值订单',
    description:
      '基于当前 purely-club 用户当前门店的套餐选择或自定义金额创建一笔待支付充值订单，并返回微信支付参数。',
  })
  @ApiCreatedResponse({ type: ClubRechargeOrderResponseDto })
  createOrder(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Body() dto: CreateClubRechargeOrderDto,
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.clubRechargeService.createOrder(currentContext, dto);
  }

  @Get('orders/:id')
  @ApiOperation({
    summary: '查询 purely-club 充值订单状态',
    description:
      '返回当前 purely-club 用户指定充值订单的状态，并补充支付流水号、回调接收时间、确认来源与状态说明，供前端仅靠查单完成支付联调收口。' +
      '传 verify=true 时会额外回微信侧核对真实支付结果，用于拉起支付后结果未知的场景。',
  })
  @ApiOkResponse({ type: ClubRechargeOrderResponseDto })
  getOrderStatus(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('id') orderId: string,
    @Query() query: ClubRechargeOrderStatusQueryDto,
  ): Promise<ClubOrderStatusResponseDto> {
    return this.clubRechargeService.getOrderStatus(
      currentContext,
      orderId,
      query,
    );
  }

  @Post('orders/:id/confirm-paid')
  @ApiOperation({
    summary: '确认 purely-club 充值订单支付成功并真实落账（开发态兜底）',
    description:
      '仅在开发态作为联调兜底保留；生产链路应由微信支付回调驱动真实落账，前端默认不再调用该接口。',
  })
  @ApiOkResponse({ type: ClubRechargeOrderResponseDto })
  confirmOrderPaid(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('id') orderId: string,
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.clubRechargeService.confirmOrderPaid(currentContext, orderId);
  }
}
