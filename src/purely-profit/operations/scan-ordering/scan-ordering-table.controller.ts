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
import type { ScanOrderingTypeResponse } from './scan-ordering-type.service';
import type {
  CreateScanOrderingTypeDto,
  UpdateScanOrderingTypeDto,
} from './dto/scan-ordering-type.dto';
import type {
  CreateScanOrderingAreaDto,
  UpdateScanOrderingAreaDto,
} from './dto/scan-ordering-area.dto';
import { ScanOrderingTypeService } from './scan-ordering-type.service';
import { ScanOrderingAreaService } from './scan-ordering-area.service';
import { ScanOrderingTableService } from './scan-ordering-table.service';
import type { ScanOrderingTableResponse } from './scan-ordering-table.service';
import { ScanOrderingQrService } from './scan-ordering-qr.service';
import type { ScanOrderingQrCodeResponse } from './scan-ordering-qr.service';
import type {
  CreateScanOrderingTableDto,
  UpdateScanOrderingTableDto,
} from './dto/scan-ordering-table.dto';

/** 扫码点餐桌台区域响应（包含时间戳）。 */
interface ScanOrderingAreaResponse {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: number; // Unix timestamp
  updatedAt?: number; // Unix timestamp
}

@ApiTags('PurelyProfit Scan Ordering - Tables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('catering')
@Controller('profit/scan-ordering/tables')
export class ScanOrderingTableController {
  constructor(
    private readonly areaService: ScanOrderingAreaService,
    private readonly typeService: ScanOrderingTypeService,
    private readonly tableService: ScanOrderingTableService,
    private readonly qrService: ScanOrderingQrService,
  ) {}

  // Area Management Routes
  @Get('areas')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '获取扫码点餐桌台区域列表' })
  async listAreas(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScanOrderingAreaResponse[]> {
    const result = await this.areaService.list(user);
    return result.map((item) => ({
      ...item,
      createdAt: item.createdAt.getTime(),
      updatedAt: item.updatedAt?.getTime(),
    }));
  }

  @Post('areas')
  @RequirePermissions('scan-ordering:table-config')
  @ApiOperation({ summary: '新增扫码点餐桌台区域' })
  async createArea(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScanOrderingAreaDto,
  ): Promise<ScanOrderingAreaResponse> {
    const result = await this.areaService.create(user, dto);
    return {
      ...result,
      createdAt: result.createdAt.getTime(),
      updatedAt: result.updatedAt.getTime(),
    };
  }

  @Patch('areas/:areaId')
  @RequirePermissions('scan-ordering:table-config')
  @ApiOperation({ summary: '更新扫码点餐桌台区域' })
  async updateArea(
    @CurrentUser() user: AuthenticatedUser,
    @Param('areaId', ParseIntPipe) areaId: number,
    @Body() dto: UpdateScanOrderingAreaDto,
  ): Promise<ScanOrderingAreaResponse> {
    const result = await this.areaService.update(user, areaId, dto);
    return {
      ...result,
      createdAt: result.createdAt.getTime(),
      updatedAt: result.updatedAt.getTime(),
    };
  }

  @Delete('areas/:areaId')
  @RequirePermissions('scan-ordering:table-config')
  @ApiOperation({ summary: '删除空的扫码点餐桌台区域' })
  removeArea(
    @CurrentUser() user: AuthenticatedUser,
    @Param('areaId', ParseIntPipe) areaId: number,
  ): Promise<void> {
    return this.areaService.remove(user, areaId);
  }

  // Type Management Routes
  @Get('types')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '获取扫码点餐桌台类型列表' })
  listTypes(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScanOrderingTypeResponse[]> {
    return this.typeService.list(user);
  }

  @Post('types')
  @RequirePermissions('scan-ordering:table-config')
  @ApiOperation({ summary: '新增扫码点餐桌台类型' })
  createType(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScanOrderingTypeDto,
  ): Promise<ScanOrderingTypeResponse> {
    return this.typeService.create(user, dto);
  }

  @Patch('types/:typeId')
  @RequirePermissions('scan-ordering:table-config')
  @ApiOperation({ summary: '更新扫码点餐桌台类型' })
  updateType(
    @CurrentUser() user: AuthenticatedUser,
    @Param('typeId', ParseIntPipe) typeId: number,
    @Body() dto: UpdateScanOrderingTypeDto,
  ): Promise<void> {
    return this.typeService.update(user, typeId, dto);
  }

  @Delete('types/:typeId')
  @RequirePermissions('scan-ordering:table-config')
  @ApiOperation({ summary: '删除空的扫码点餐桌台类型' })
  removeType(
    @CurrentUser() user: AuthenticatedUser,
    @Param('typeId', ParseIntPipe) typeId: number,
  ): Promise<void> {
    return this.typeService.remove(user, typeId);
  }

  // Table Management Routes
  @Get()
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '获取商家扫码点餐桌台列表' })
  listTables(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScanOrderingTableResponse[]> {
    return this.tableService.listTables(user);
  }

  @Post()
  @RequirePermissions('scan-ordering:table-config')
  @ApiOperation({ summary: '新增商家扫码点餐桌台' })
  createTable(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScanOrderingTableDto,
  ): Promise<ScanOrderingTableResponse> {
    return this.tableService.createTable(user, dto);
  }

  @Patch(':tableId')
  @RequirePermissions('scan-ordering:table-config')
  @ApiOperation({ summary: '编辑商家扫码点餐桌台' })
  updateTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tableId', ParseIntPipe) tableId: number,
    @Body() dto: UpdateScanOrderingTableDto,
  ): Promise<void> {
    return this.tableService.updateTable(user, tableId, dto);
  }

  @Post(':tableId/clear')
  @RequirePermissions('scan-ordering:table-manage')
  @ApiOperation({ summary: '清理已完成结账的桌台' })
  clearTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tableId', ParseIntPipe) tableId: number,
  ): Promise<void> {
    return this.tableService.clearTable(user, tableId);
  }

  @Delete(':tableId')
  @RequirePermissions('scan-ordering:table-config')
  @ApiOperation({ summary: '删除空的扫码点餐桌台' })
  removeTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tableId', ParseIntPipe) tableId: number,
  ): Promise<void> {
    return this.tableService.removeTable(user, tableId);
  }

  // QR Code Routes
  @Get('qr-codes/export')
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

  @Get(':tableId/qr-codes/current')
  @RequirePermissions('scan-ordering:table-manage')
  @ApiOperation({ summary: '获取当前有效桌码（不轮换、不作废旧码）' })
  getCurrentQrCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tableId', ParseIntPipe) tableId: number,
  ): Promise<ScanOrderingQrCodeResponse> {
    return this.qrService.getCurrentQrCode(user, tableId);
  }

  @Post(':tableId/qr-codes')
  @RequirePermissions('scan-ordering:table-manage')
  @ApiOperation({ summary: '轮换桌台二维码（旧桌码立即失效）' })
  rotateQrCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tableId', ParseIntPipe) tableId: number,
  ): Promise<ScanOrderingQrCodeResponse> {
    return this.qrService.rotateQrCode(user, tableId);
  }
}
