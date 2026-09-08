import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubSelfOrderingService } from './club-self-ordering.service';
import { ClubSelfOrderingOrderService } from './club-self-ordering-order.service';
import { ClubSelfOrderingPaymentService } from './club-self-ordering-payment.service';
import { ClubSelfOrderingMenuService } from './club-self-ordering-menu.service';
import { CreateSelfOrderDto } from './dto/create-self-order.dto';
import { CreateSelfOrderWechatPaymentDto } from './dto/create-self-order-payment.dto';
import { ResolveSpaceDto } from './dto/resolve-space.dto';
import { SelfOrderingMenuQueryDto } from './dto/self-ordering-menu-query.dto';

@ApiTags('PurelyClub Self Ordering')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@Controller('club/self-ordering')
export class ClubSelfOrderingController {
  constructor(
    private readonly service: ClubSelfOrderingService,
    private readonly orderService: ClubSelfOrderingOrderService,
    private readonly paymentService: ClubSelfOrderingPaymentService,
    private readonly menuService: ClubSelfOrderingMenuService,
  ) {}

  @Post('resolve-space')
  @ApiOperation({ summary: '扫描空间二维码，定位当前进行中的空间会话' })
  resolveSpace(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ResolveSpaceDto,
  ) {
    return this.service.resolveSpace(user, dto);
  }

  @Get('menu')
  @ApiOperation({
    summary: '自助下单菜单（非餐饮门店商品库，需先扫码定位会话）',
  })
  getMenu(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: SelfOrderingMenuQueryDto,
  ) {
    return this.menuService.getMenu(user, dto.sessionId);
  }

  @Post('orders')
  @ApiOperation({
    summary: '创建自助下单订单（需携带 Idempotency-Key 请求头）',
  })
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSelfOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.orderService.create(user, dto, idempotencyKey);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: '查询自助下单订单详情（供支付结果轮询）' })
  getOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.orderService.findOwnedOrder(user, orderId);
  }

  @Post('orders/:orderId/payments/balance')
  @ApiOperation({ summary: '储值余额支付自助下单订单' })
  createBalancePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.paymentService.createBalancePayment(user, orderId);
  }

  @Post('orders/:orderId/payments/wechat-jsapi')
  @ApiOperation({
    summary: '微信支付自助下单订单',
    description:
      'openid 缺省时不调起真实微信支付，paymentParams 返回空，供开发态兜底',
  })
  createWechatPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CreateSelfOrderWechatPaymentDto,
  ) {
    return this.paymentService.createWechatPayment(user, orderId, dto.openid);
  }

  @Post('orders/:orderId/confirm-paid')
  @ApiOperation({ summary: '开发环境确认自助下单支付（生产环境不可用）' })
  confirmPaidForDevelopment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.paymentService.confirmPaidForDevelopment(user, orderId);
  }
}
