import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  CreateSalesRecordDto,
  ListSalesProductsQueryDto,
  ListSalesRecordsQueryDto,
  SalesProductResponseDto,
  SalesRecordListResponseDto,
  SalesRecordResponseDto,
  SalesReportQueryDto,
  SalesReportResponseDto,
  SalesStatsQueryDto,
  SalesStatsResponseDto,
} from './dto/sales-record.dto';
import { SalesRecordService } from './sales-record.service';

@ApiTags('Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sales-record')
export class SalesRecordController {
  constructor(private readonly salesRecordService: SalesRecordService) {}

  @Get('products')
  @RequirePermissions('operation-entry:view')
  @ApiOperation({ summary: '获取开始营业商品列表' })
  @ApiOkResponse({ type: [SalesProductResponseDto] })
  listProducts(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListSalesProductsQueryDto,
  ): Promise<SalesProductResponseDto[]> {
    return this.salesRecordService.listProducts(request.user, query);
  }

  @Get()
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: '获取销售记录列表' })
  @ApiOkResponse({ type: SalesRecordListResponseDto })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    return this.salesRecordService.list(request.user, query);
  }

  @Get('stats')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: '获取销售记录统计' })
  @ApiOkResponse({ type: SalesStatsResponseDto })
  getStats(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: SalesStatsQueryDto,
  ): Promise<SalesStatsResponseDto> {
    return this.salesRecordService.getStats(request.user, query);
  }

  @Get('report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取报表中心销售报表数据' })
  @ApiOkResponse({ type: SalesReportResponseDto })
  getReport(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: SalesReportQueryDto,
  ): Promise<SalesReportResponseDto> {
    return this.salesRecordService.getReport(request.user, query);
  }

  @Post()
  @RequirePermissions('sales:create')
  @ApiOperation({ summary: '新增销售记录' })
  @ApiCreatedResponse({ type: SalesRecordResponseDto })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateSalesRecordDto,
  ): Promise<SalesRecordResponseDto> {
    return this.salesRecordService.create(request.user, dto);
  }

  @Delete(':id')
  @RequirePermissions('sales:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除销售记录' })
  @ApiNoContentResponse()
  async remove(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) salesRecordId: number,
  ): Promise<void> {
    await this.salesRecordService.remove(request.user, salesRecordId);
  }
}

@ApiTags('Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller(['sales/orders', 'sales-orders'])
export class SalesOrdersCompatController {
  constructor(private readonly salesRecordService: SalesRecordService) {}

  @Get('products')
  @RequirePermissions('operation-entry:view')
  @ApiOperation({ summary: '获取开始营业商品列表（purelyProfit 前端兼容）' })
  @ApiOkResponse({ type: [SalesProductResponseDto] })
  listProducts(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListSalesProductsQueryDto,
  ): Promise<SalesProductResponseDto[]> {
    return this.salesRecordService.listProducts(request.user, query);
  }

  @Get()
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: '获取销售记录列表（purelyProfit 前端兼容）' })
  @ApiOkResponse({ type: SalesRecordListResponseDto })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    return this.salesRecordService.listFrontendOrders(request.user, query);
  }

  @Get('report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取报表中心销售报表数据（purelyProfit 前端兼容）' })
  @ApiOkResponse({ type: SalesReportResponseDto })
  getReport(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: SalesReportQueryDto,
  ): Promise<SalesReportResponseDto> {
    return this.salesRecordService.getReport(request.user, query);
  }

  @Post()
  @RequirePermissions('operation-entry:create')
  @ApiOperation({ summary: '新增销售记录（purelyProfit 前端兼容）' })
  @ApiCreatedResponse({ type: SalesRecordResponseDto })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateSalesRecordDto,
  ): Promise<SalesRecordResponseDto> {
    return this.salesRecordService.create(request.user, dto, {
      skipAccessCheck: true,
      assignToCurrentShiftOperator: true,
    });
  }

  @Delete(':id')
  @RequirePermissions('sales:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除销售记录（purelyProfit 前端兼容）' })
  @ApiNoContentResponse()
  async remove(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) salesRecordId: number,
  ): Promise<void> {
    await this.salesRecordService.remove(request.user, salesRecordId);
  }
}
