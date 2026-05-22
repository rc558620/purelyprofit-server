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
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  AdjustInventoryDto,
  InventoryAdjustmentResponseDto,
  InventoryProductResponseDto,
  InventoryReportResponseDto,
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
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListInventoryProductsQueryDto,
  ): Promise<InventoryProductResponseDto[]> {
    return this.inventoryService.listProducts(request.user, query);
  }

  @Delete('products/:id')
  @RequirePermissions('goods:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除库存盘点商品' })
  async removeProduct(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) productId: number,
  ): Promise<void> {
    await this.inventoryService.removeProduct(request.user, productId);
  }

  @Get('adjustments')
  @RequirePermissions('inventory:view')
  @ApiOperation({ summary: '获取库存调整记录列表' })
  @ApiOkResponse({ type: PaginatedInventoryAdjustmentsResponseDto })
  listAdjustments(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListInventoryAdjustmentsQueryDto,
  ): Promise<PaginatedInventoryAdjustmentsResponseDto> {
    return this.inventoryService.listAdjustments(request.user, query);
  }

  @Post('adjustments')
  @RequirePermissions('inventory:update')
  @ApiOperation({ summary: '新增库存调整记录' })
  @ApiCreatedResponse({ type: InventoryAdjustmentResponseDto })
  adjust(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: AdjustInventoryDto,
  ): Promise<InventoryAdjustmentResponseDto> {
    return this.inventoryService.adjust(request.user, dto);
  }

  @Patch('products/:id/alert-threshold')
  @RequirePermissions('inventory:update')
  @ApiOperation({ summary: '更新商品库存预警阈值' })
  @ApiOkResponse({ type: ProductThresholdResponseDto })
  updateAlertThreshold(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) productId: number,
    @Body() dto: UpdateAlertThresholdDto,
  ): Promise<ProductThresholdResponseDto> {
    return this.inventoryService.updateAlertThreshold(
      request.user,
      productId,
      dto,
    );
  }

  @Get('stats')
  @RequirePermissions('inventory:view')
  @ApiOperation({ summary: '获取库存统计' })
  @ApiOkResponse({ type: InventoryStatsResponseDto })
  getStats(
    @Req() request: { user: AuthenticatedUser },
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<InventoryStatsResponseDto> {
    return this.inventoryService.getStats(request.user, storeId);
  }

  @Get('report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取报表中心库存报表数据' })
  @ApiOkResponse({ type: InventoryReportResponseDto })
  getReport(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListInventoryProductsQueryDto,
  ): Promise<InventoryReportResponseDto> {
    return this.inventoryService.getReport(request.user, query);
  }
}
