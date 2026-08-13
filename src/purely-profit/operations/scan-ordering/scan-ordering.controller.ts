import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
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
import type { ScanOrderingPickupSettings } from '../../../purely-club/scan-ordering/scan-ordering-pickup-settings.service';
import { ScanOrderingPickupSettingsService } from '../../../purely-club/scan-ordering/scan-ordering-pickup-settings.service';
import { UpdateScanOrderingPickupSettingsDto } from './dto/scan-ordering-pickup-settings.dto';
import { UpdateScanOrderingMenuCategoryDto } from './dto/scan-ordering-category-update.dto';
import {
  CreateScanOrderingMenuCategoryDto,
  CreateScanOrderingMenuProductDto,
  UpdateScanOrderingMenuProductAvailabilityDto,
} from './dto/scan-ordering-menu.dto';
import { UpdateScanOrderingMenuProductDto } from './dto/scan-ordering-menu-update.dto';
import type { ScanOrderingMenuCategoryResponse } from './scan-ordering-menu-category.service';
import { ScanOrderingMenuService } from './scan-ordering-menu.service';
import type { ScanOrderingMenuProductResponse } from './scan-ordering-menu-product.service';

/** 扫码点餐核心域：经营看板、取餐配置与菜单管理。 */
@ApiTags('PurelyProfit Scan Ordering - Core')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('catering')
@Controller('profit/scan-ordering')
export class ScanOrderingMainController {
  constructor(
    private readonly dashboardService: ScanOrderingDashboardService,
    private readonly pickupSettingsService: ScanOrderingPickupSettingsService,
    private readonly menuService: ScanOrderingMenuService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '获取商家扫码点餐经营看板' })
  getDashboard(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScanOrderingDashboardResponse> {
    return this.dashboardService.getDashboard(user);
  }

  @Get('pickup-settings')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '获取门店扫码点餐取餐语音播报配置' })
  getPickupSettings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScanOrderingPickupSettings> {
    return this.pickupSettingsService.getForMerchant(user);
  }

  @Patch('pickup-settings')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({
    summary: '更新门店扫码点餐取餐配置（语音播报 / 出餐自动打印开关）',
  })
  updatePickupSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateScanOrderingPickupSettingsDto,
  ): Promise<ScanOrderingPickupSettings> {
    return this.pickupSettingsService.updateForMerchant(user, dto);
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
}
