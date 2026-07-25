import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ParseIntPipe } from '@nestjs/common';
import { ScanOrderingOrderService } from './scan-ordering-order.service';
import type {
  ProcessScanOrderingOrderDto,
  RejectOrCancelScanOrderingOrderDto,
  CompleteScanOrderingRefundDto,
  ListScanOrderingOrdersQueryDto,
} from './dto/scan-ordering-order.dto';
import type { ScanOrderingOrderListItem } from './scan-ordering.types';

@ApiTags('PurelyProfit Scan Ordering - Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('catering')
@Controller('profit/scan-ordering/orders')
export class ScanOrderingOrderController {
  constructor(private readonly orderService: ScanOrderingOrderService) {}

  @Get()
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '获取商家扫码点餐订单队列' })
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListScanOrderingOrdersQueryDto,
  ): Promise<{
    items: ScanOrderingOrderListItem[];
    nextCursor: number | null;
  }> {
    return this.orderService.listOrders(user, query);
  }

  @Get(':orderId')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '获取扫码点餐订单详情及状态历史' })
  getOrderDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<unknown> {
    return this.orderService.getOrderDetail(user, orderId);
  }

  @Post(':orderId/accept')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({ summary: '接单并进入制作中状态' })
  acceptOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: ProcessScanOrderingOrderDto,
  ): Promise<void> {
    return this.orderService.acceptOrder(user, orderId, dto.version);
  }

  @Post(':orderId/reject')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({ summary: '拒绝待接单的未退款订单' })
  rejectOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: RejectOrCancelScanOrderingOrderDto,
  ): Promise<void> {
    return this.orderService.rejectOrder(
      user,
      orderId,
      dto.version,
      dto.reason,
    );
  }

  @Post(':orderId/cancel')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({ summary: '取消未支付订单' })
  cancelOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: RejectOrCancelScanOrderingOrderDto,
  ): Promise<void> {
    return this.orderService.cancelOrder(
      user,
      orderId,
      dto.version,
      dto.reason,
    );
  }

  @Post(':orderId/complete-refund')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({ summary: '确认拒单退款完成并归还库存' })
  completeRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CompleteScanOrderingRefundDto,
  ): Promise<void> {
    return this.orderService.completeRefund(
      user,
      orderId,
      dto.version,
      dto.providerRefundNo,
      dto.providerRefundId,
    );
  }

  @Post(':orderId/serve')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({ summary: '标记订单已出餐' })
  serveOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: ProcessScanOrderingOrderDto,
  ): Promise<void> {
    return this.orderService.serveOrder(user, orderId, dto.version);
  }

  @Post(':orderId/complete')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({ summary: '结账并完成已出餐订单' })
  completeOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: ProcessScanOrderingOrderDto,
  ): Promise<void> {
    return this.orderService.completeOrder(user, orderId, dto.version);
  }
}
