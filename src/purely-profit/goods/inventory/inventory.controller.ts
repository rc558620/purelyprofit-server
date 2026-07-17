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
  Res,
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
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  AdjustInventoryDto,
  InventoryAdjustmentResponseDto,
  InventoryReportResponseDto,
  InventoryStatsQueryDto,
  InventoryStatsResponseDto,
  ListInventoryAdjustmentsQueryDto,
  ListInventoryProductsQueryDto,
  PaginatedInventoryAdjustmentsResponseDto,
  PaginatedInventoryProductsResponseDto,
  ProductThresholdResponseDto,
  UpdateAlertThresholdDto,
} from './dto/inventory.dto';
import { InventoryReadService } from './inventory-read.service';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly inventoryReadService: InventoryReadService,
  ) {}

  @Get('products')
  @RequirePermissions('inventory:view')
  @ApiOperation({ summary: '获取库存盘点商品列表' })
  @ApiOkResponse({ type: PaginatedInventoryProductsResponseDto })
  listProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInventoryProductsQueryDto,
  ): Promise<PaginatedInventoryProductsResponseDto> {
    return this.inventoryReadService.listProducts(user, query);
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
    return this.inventoryReadService.listAdjustments(user, query);
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
    return this.inventoryReadService.getStats(user, query.storeId);
  }

  @Get('report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取报表中心库存报表数据' })
  @ApiOkResponse({ type: InventoryReportResponseDto })
  async getReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInventoryProductsQueryDto,
    @Res({ passthrough: true }) reply: { raw: ServerResponse },
  ): Promise<InventoryReportResponseDto | typeof reply> {
    if (query.format === 'csv') {
      /*
       * D1 修复：CSV 导出与 JSON 导出共用同一权限门控，
       * 强制标记 export=true，确保 ensureReportExportEnabled 被调用，
       * 防止拥有 report:view 但套餐不支持导出的账号借 format=csv 绕过校验。
       */
      query.export = true;
      await this.inventoryReadService.streamReportCsv(reply.raw, user, query);
      return reply;
    }
    return this.inventoryReadService.getReport(user, query);
  }
}
