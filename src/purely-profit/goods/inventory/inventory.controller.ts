import { CurrentUser } from '../../auth/current-user.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  AdjustInventoryDto,
  InventoryAdjustmentResponseDto,
  InventoryProductResponseDto,
  InventoryReportResponseDto,
  InventoryStatsQueryDto,
  InventoryStatsResponseDto,
  ListInventoryAdjustmentsQueryDto,
  ListInventoryProductsQueryDto,
  PaginatedInventoryAdjustmentsResponseDto,
  ProductThresholdResponseDto,
  UpdateAlertThresholdDto,
} from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('products')
  @RequirePermissions('inventory:view')
  @ApiOperation({ summary: '获取库存盘点商品列表' })
  @ApiOkResponse({ type: [InventoryProductResponseDto] })
  listProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInventoryProductsQueryDto,
  ): Promise<InventoryProductResponseDto[]> {
    return this.inventoryService.listProducts(user, query);
  }

  @Delete('products/:id')
  @RequirePermissions('goods:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除库存盘点商品' })
  async removeProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) productId: number,
  ): Promise<void> {
    await this.inventoryService.removeProduct(user, productId);
  }

  @Get('adjustments')
  @RequirePermissions('inventory:view')
  @ApiOperation({ summary: '获取库存调整记录列表' })
  @ApiOkResponse({ type: PaginatedInventoryAdjustmentsResponseDto })
  listAdjustments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInventoryAdjustmentsQueryDto,
  ): Promise<PaginatedInventoryAdjustmentsResponseDto> {
    return this.inventoryService.listAdjustments(user, query);
  }

  /*
   * BUG-5 注释澄清：@RequirePermissions 列出两个权限是 OR 语义（Guard 用 hasAnyPermission），
   * 与 service 层 resolveAdjustPermission 的动态判断配合——
   * Guard 先确保用户至少有其中一个权限，service 再根据 adjustType/mode 决定具体需要哪个。
   */
  @Post('adjustments')
  @RequirePermissions('inventory:update', 'operation-entry:create')
  @ApiOperation({ summary: '新增库存调整记录' })
  @ApiCreatedResponse({ type: InventoryAdjustmentResponseDto })
  adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AdjustInventoryDto,
  ): Promise<InventoryAdjustmentResponseDto> {
    return this.inventoryService.adjust(user, dto);
  }

  @Patch('products/:id/alert-threshold')
  @RequirePermissions('inventory:update')
  @ApiOperation({ summary: '更新商品库存预警阈值' })
  @ApiOkResponse({ type: ProductThresholdResponseDto })
  updateAlertThreshold(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) productId: number,
    @Body() dto: UpdateAlertThresholdDto,
  ): Promise<ProductThresholdResponseDto> {
    return this.inventoryService.updateAlertThreshold(user, productId, dto);
  }

  @Get('stats')
  @RequirePermissions('inventory:view')
  @ApiOperation({ summary: '获取库存统计' })
  @ApiOkResponse({ type: InventoryStatsResponseDto })
  getStats(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: InventoryStatsQueryDto,
  ): Promise<InventoryStatsResponseDto> {
    return this.inventoryService.getStats(user, query.storeId);
  }

  @Get('report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取报表中心库存报表数据' })
  @ApiOkResponse({ type: InventoryReportResponseDto })
  getReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInventoryProductsQueryDto,
  ): Promise<InventoryReportResponseDto> {
    return this.inventoryService.getReport(user, query);
  }
}
