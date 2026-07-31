import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubScanOrderingService } from './club-scan-ordering.service';
import { ClubScanOrderingCartService } from './club-scan-ordering-cart.service';
import { ClubScanOrderingOrderService } from './club-scan-ordering-order.service';
import {
  AddClubScanCartItemDto,
  CancelClubScanOrderDto,
  ClubScanSessionQueryDto,
  CreateClubScanOrderDto,
  CreateClubScanBalancePaymentDto,
  CreateClubScanPaymentDto,
  CreateClubScanServiceCallDto,
  CreateClubScanSessionDto,
  ListClubScanOrdersQueryDto,
  PreviewClubScanOrderDto,
  ResolveClubScanQrDto,
  UpdateClubScanCartItemDto,
  UpdateClubScanSessionDto,
} from './dto/club-scan-ordering.dto';

@ApiTags('Club / Scan Ordering')
@Controller('club/scan-ordering')
export class ClubScanOrderingController {
  constructor(
    private readonly service: ClubScanOrderingService,
    private readonly cartService: ClubScanOrderingCartService,
    private readonly orderService: ClubScanOrderingOrderService,
  ) {}

  @Post('scan/resolve')
  @ApiOperation({ summary: '解析扫码点餐桌码' })
  resolveQr(@Body() dto: ResolveClubScanQrDto): Promise<unknown> {
    return this.service.resolveQrToken(dto.qrToken);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Post('sessions')
  @ApiOperation({ summary: '建立或恢复当前用户桌台会话' })
  createSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClubScanSessionDto,
  ): Promise<unknown> {
    return this.service.createOrRestoreSession(user, dto);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Get('sessions/current')
  @ApiOperation({ summary: '获取当前用户有效桌台会话' })
  getCurrentSession(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.service.getCurrentSession(user);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Patch('sessions/current')
  @ApiOperation({ summary: '更新当前会话就餐人数' })
  updateCurrentSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateClubScanSessionDto,
  ): Promise<unknown> {
    return this.service.updateCurrentSession(user, dto);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Post('sessions/current/leave')
  @ApiOperation({ summary: '退出当前桌台会话' })
  async leaveCurrentSession(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.service.leaveCurrentSession(user);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Get('menu')
  @ApiOperation({ summary: '获取当前会话可售菜单' })
  getMenu(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ClubScanSessionQueryDto,
  ): Promise<unknown> {
    return this.service.getMenu(user, query.sessionId);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Get('cart')
  @ApiOperation({ summary: '获取当前会话购物车' })
  getCart(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ClubScanSessionQueryDto,
  ): Promise<unknown> {
    return this.cartService.getCart(user, query.sessionId);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Post('cart/items')
  @ApiOperation({ summary: '添加扫码点餐购物车商品' })
  addCartItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddClubScanCartItemDto,
  ): Promise<unknown> {
    return this.cartService.addCartItem(user, dto);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Patch('cart/items/:itemId')
  @ApiOperation({ summary: '更新扫码点餐购物车商品数量' })
  updateCartItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateClubScanCartItemDto,
  ): Promise<unknown> {
    return this.cartService.updateCartItem(user, itemId, dto);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Delete('cart/items/:itemId')
  @ApiOperation({ summary: '删除扫码点餐购物车商品' })
  removeCartItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Query('version', ParseIntPipe) version: number,
  ): Promise<unknown> {
    return this.cartService.removeCartItem(user, itemId, version);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Post('orders/preview')
  @ApiOperation({ summary: '预览扫码点餐订单金额' })
  previewOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PreviewClubScanOrderDto,
  ): Promise<unknown> {
    return this.orderService.preview(user, dto);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Post('orders')
  @ApiOperation({ summary: '幂等创建扫码点餐订单' })
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClubScanOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<unknown> {
    return this.orderService.create(user, idempotencyKey, dto);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Get('orders')
  @ApiOperation({ summary: '获取当前用户扫码点餐订单列表' })
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListClubScanOrdersQueryDto,
  ): Promise<unknown> {
    return this.orderService.listOrders(user, query);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Get('order-history')
  @ApiOperation({ summary: '获取当前用户已归档的扫码点餐记录' })
  listOrderHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListClubScanOrdersQueryDto,
  ): Promise<unknown> {
    return this.orderService.listOrderHistory(user, query);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Get('orders/:orderId')
  @ApiOperation({ summary: '获取当前用户扫码点餐订单详情' })
  getOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<unknown> {
    return this.orderService.getOrder(user, orderId);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Post('orders/:orderId/payments/wechat-jsapi')
  @ApiOperation({ summary: '发起扫码点餐微信 JSAPI 支付' })
  createWechatPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CreateClubScanPaymentDto,
  ): Promise<unknown> {
    return this.orderService.createWechatPayment(user, orderId, dto.openid);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Post('orders/:orderId/payments/balance')
  @ApiOperation({ summary: '使用门店储值余额支付扫码点餐订单' })
  createBalancePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CreateClubScanBalancePaymentDto,
  ): Promise<unknown> {
    return this.orderService.createBalancePayment(user, orderId, dto.version);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Post('orders/:orderId/confirm-paid')
  @ApiOperation({ summary: '开发环境确认扫码点餐支付' })
  confirmPaidForDevelopment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<unknown> {
    return this.orderService.confirmPaidForDevelopment(user, orderId);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Post('orders/:orderId/cancel')
  @ApiOperation({ summary: '取消待支付扫码点餐订单' })
  async cancelOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CancelClubScanOrderDto,
  ): Promise<void> {
    await this.orderService.cancelOrder(user, orderId, dto.version);
  }

  @UseGuards(ClubJwtAuthGuard)
  @ApiBearerAuth()
  @Post('service-calls')
  @ApiOperation({ summary: '呼叫服务员' })
  createServiceCall(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClubScanServiceCallDto,
  ): Promise<unknown> {
    return this.service.createServiceCall(user, dto);
  }
}
