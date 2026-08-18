// 录入订单控制器：菜单聚合、价格预览与建单（purely-profit 商家侧手工补录线下交易）

import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../../access-control/guards/permissions.guard';
import { BusinessModeGuard } from '../../../stores/business-mode.guard';
import { RequireBusinessMode } from '../../../stores/business-mode.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/strategies/jwt.strategy';
import { ManualEntryMenuService } from './manual-entry-menu.service';
import { ManualEntryOrderService } from './manual-entry-order.service';
import type {
  CreateManualEntryOrderDto,
  ManualEntryPreviewDto,
} from './dto/manual-entry.dto';
import type {
  ManualEntryMenuResponse,
  ManualEntryOrderCreatedResponse,
  ManualEntryPreviewResponse,
} from './manual-entry.types';

/** 录入订单控制器（purely-profit）：扫码点餐菜单选品 + 手工补录建单。 */
@ApiTags('PurelyProfit Manual Entry')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('catering')
@Controller('profit/scan-ordering/manual-entry')
export class ManualEntryController {
  constructor(
    private readonly menuService: ManualEntryMenuService,
    private readonly orderService: ManualEntryOrderService,
  ) {}

  @Get('menu')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({
    summary: '获取录入订单菜单（分类+商品+规格+库存，含售罄态）',
  })
  getMenu(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManualEntryMenuResponse> {
    return this.menuService.listMenu(user);
  }

  @Post('preview')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({
    summary:
      '录入订单价格预览（规格组合单价/商品合计/券面抵扣/应付，金额后端权威计算）',
  })
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManualEntryPreviewDto,
  ): Promise<ManualEntryPreviewResponse> {
    return this.orderService.preview(user, dto);
  }

  @Post('orders')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({
    summary: '录入订单建单（幂等，事务内预留库存并创建 ScanOrders，走状态机/出餐时落销售记录）',
  })
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateManualEntryOrderDto,
  ): Promise<ManualEntryOrderCreatedResponse> {
    return this.orderService.create(user, idempotencyKey, dto);
  }
}
