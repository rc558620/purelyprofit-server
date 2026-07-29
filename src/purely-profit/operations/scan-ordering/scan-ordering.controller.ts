import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
import type { ScanOrderingDashboardResponse } from './scan-ordering.types';
import { ScanOrderingDashboardService } from './scan-ordering-dashboard.service';
import type { ScanOrderingQrCodeResponse } from './scan-ordering-qr.service';
import { ScanOrderingQrService } from './scan-ordering-qr.service';
import { ScanOrderingServiceCallService } from './scan-ordering-service-call.service';
import type {
  ListScanOrderingServiceCallsDto,
  ProcessScanOrderingServiceCallDto,
} from './dto/scan-ordering-service-call.dto';
import { UpdateScanOrderingMenuCategoryDto } from './dto/scan-ordering-category-update.dto';
import {
  CreateScanOrderingMenuCategoryDto,
  CreateScanOrderingMenuProductDto,
  UpdateScanOrderingMenuProductAvailabilityDto,
} from './dto/scan-ordering-menu.dto';
import { UpdateScanOrderingMenuProductDto } from './dto/scan-ordering-menu-update.dto';
import type { ScanOrderingMenuCategoryResponse } from './scan-ordering-menu-category.service';
import { ScanOrderingMenuService } from './scan-ordering-menu.service';
import type {
  CreateScanOrderingTableDto,
  UpdateScanOrderingTableDto,
} from './dto/scan-ordering-table.dto';
import { ScanOrderingTableService } from './scan-ordering-table.service';
import type { ScanOrderingTableResponse } from './scan-ordering-table.service';
import type { ScanOrderingMenuProductResponse } from './scan-ordering-menu-product.service';

@ApiTags('PurelyProfit Scan Ordering - Core')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('catering')
@Controller('profit/scan-ordering')
export class ScanOrderingMainController {
  constructor(
    private readonly dashboardService: ScanOrderingDashboardService,
    private readonly qrService: ScanOrderingQrService,
    private readonly serviceCallService: ScanOrderingServiceCallService,
    private readonly menuService: ScanOrderingMenuService,
    private readonly tableService: ScanOrderingTableService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '获取商家扫码点餐经营看板' })
  getDashboard(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScanOrderingDashboardResponse> {
    return this.dashboardService.getDashboard(user);
  }

  // Menu Management Routes
  @Get('menu')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '获取商家扫码点餐菜单配置' })
  getMenu(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScanOrderingMenuCategoryResponse[]> {
    return this.menuService.listMenu(user);
  }

  @Post('menu/categories')
  @RequirePermissions('scan-ordering:menu-manage')
  @ApiOperation({ summary: '新增扫码点餐菜单分类' })
  createMenuCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScanOrderingMenuCategoryDto,
  ): Promise<ScanOrderingMenuCategoryResponse> {
    return this.menuService.createCategory(user, dto);
  }

  @Patch('menu/categories/:categoryId')
  @RequirePermissions('scan-ordering:menu-manage')
  @ApiOperation({ summary: '编辑菜单分类' })
  updateMenuCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Body() dto: UpdateScanOrderingMenuCategoryDto,
  ): Promise<void> {
    return this.menuService.updateCategory(user, categoryId, dto);
  }

  @Delete('menu/categories/:categoryId')
  @RequirePermissions('scan-ordering:menu-manage')
  @ApiOperation({ summary: '删除不含商品的菜单分类' })
  removeMenuCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoryId', ParseIntPipe) categoryId: number,
  ): Promise<void> {
    return this.menuService.removeCategory(user, categoryId);
  }

  @Post('menu/products')
  @RequirePermissions('scan-ordering:menu-manage')
  @ApiOperation({ summary: '新增扫码点餐商品' })
  createMenuProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScanOrderingMenuProductDto,
  ): Promise<ScanOrderingMenuProductResponse> {
    return this.menuService.createProduct(user, dto);
  }

  @Patch('menu/products/:productId')
  @RequirePermissions('scan-ordering:menu-manage')
  @ApiOperation({ summary: '编辑扫码点餐商品' })
  updateMenuProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateScanOrderingMenuProductDto,
  ): Promise<void> {
    return this.menuService.updateProduct(user, productId, dto);
  }

  @Delete('menu/products/:productId')
  @RequirePermissions('scan-ordering:menu-manage')
  @ApiOperation({ summary: '删除扫码点餐商品' })
  removeMenuProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<void> {
    return this.menuService.removeProduct(user, productId);
  }

  @Patch('menu/products/:productId/availability')
  @RequirePermissions('scan-ordering:menu-manage')
  @ApiOperation({ summary: '更新商品上下架状态' })
  updateMenuProductAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateScanOrderingMenuProductAvailabilityDto,
  ): Promise<void> {
    return this.menuService.updateProductAvailability(user, productId, dto);
  }

  // QR Code Routes
  @Get('tables/qr-codes/export')
  @RequirePermissions('scan-ordering:table-manage')
  @ApiOperation({ summary: '导出桌台二维码元数据' })
  exportQrCodes(@CurrentUser() user: AuthenticatedUser): Promise<
    Array<{
      tableId: number;
      tableCode: string;
      tableName: string;
      qrCodeVersion: number;
      qrCodeStatus: string;
    }>
  > {
    return this.qrService.exportQrCodes(user);
  }

  @Get('tables/:tableId/qr-codes/current')
  @RequirePermissions('scan-ordering:table-manage')
  @ApiOperation({ summary: '获取当前有效桌码（不轮换、不作废旧码）' })
  getCurrentQrCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tableId', ParseIntPipe) tableId: number,
  ): Promise<ScanOrderingQrCodeResponse> {
    return this.qrService.getCurrentQrCode(user, tableId);
  }

  @Post('tables/:tableId/qr-codes')
  @RequirePermissions('scan-ordering:table-manage')
  @ApiOperation({ summary: '轮换桌台二维码（旧桌码立即失效）' })
  rotateQrCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tableId', ParseIntPipe) tableId: number,
  ): Promise<ScanOrderingQrCodeResponse> {
    return this.qrService.rotateQrCode(user, tableId);
  }

  // Service Call Routes
  @Get('service-calls')
  @RequirePermissions('service-call:view')
  @ApiOperation({ summary: '获取商家端扫码点餐服务呼叫待办' })
  listServiceCalls(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListScanOrderingServiceCallsDto,
  ): Promise<
    Array<{
      id: number;
      type: string;
      status: string;
      requestedAt: Date;
      processingStartedAt: Date | null;
      completedAt: Date | null;
      locationLabel: string | null;
      remark: string | null;
    }>
  > {
    return this.serviceCallService.list(user, dto);
  }

  @Post('service-calls/:serviceCallId/process')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({ summary: '确认响应或完成服务呼叫' })
  processServiceCall(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serviceCallId', ParseIntPipe) serviceCallId: number,
    @Body() dto: ProcessScanOrderingServiceCallDto,
  ): Promise<void> {
    return this.serviceCallService.process(user, serviceCallId, dto);
  }

  // Table Management Routes (简化的)
  @Get('tables')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '获取商家扫码点餐桌台列表' })
  listTables(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScanOrderingTableResponse[]> {
    return this.tableService.listTables(user);
  }

  @Post('tables')
  @RequirePermissions('scan-ordering:table-manage')
  @ApiOperation({ summary: '新增商家扫码点餐桌台' })
  createTable(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScanOrderingTableDto,
  ): Promise<ScanOrderingTableResponse> {
    return this.tableService.createTable(user, dto);
  }

  @Patch('tables/:tableId')
  @RequirePermissions('scan-ordering:table-manage')
  @ApiOperation({ summary: '编辑商家扫码点餐桌台' })
  updateTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tableId', ParseIntPipe) tableId: number,
    @Body() dto: UpdateScanOrderingTableDto,
  ): Promise<void> {
    return this.tableService.updateTable(user, tableId, dto);
  }

  @Post('tables/:tableId/clear')
  @RequirePermissions('scan-ordering:table-manage')
  @ApiOperation({ summary: '清理已完成结账的桌台' })
  clearTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tableId', ParseIntPipe) tableId: number,
  ): Promise<void> {
    return this.tableService.clearTable(user, tableId);
  }

  @Delete('tables/:tableId')
  @RequirePermissions('scan-ordering:table-manage')
  @ApiOperation({ summary: '删除空的扫码点餐桌台' })
  removeTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tableId', ParseIntPipe) tableId: number,
  ): Promise<void> {
    return this.tableService.removeTable(user, tableId);
  }
}
