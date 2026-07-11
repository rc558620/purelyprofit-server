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
  Post,
  Query,
  Res,
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
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CostsService } from './costs.service';
import {
  CostRecordStatsQueryDto,
  CostReportQueryDto,
  CreateCostRecordDto,
  ListCostRecordsQueryDto,
} from './dto/costs-query.dto';
import {
  CostDashboardResponseDto,
  CostRecordListResponseDto,
  CostRecordResponseDto,
  CostReportResponseDto,
  CostStatsResponseDto,
} from './dto/costs-response.dto';

@ApiTags('Costs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller(['costs', 'cost-records'])
export class CostsController {
  constructor(private readonly costsService: CostsService) {}

  @Get(['records', ''])
  @RequirePermissions('cost:view')
  @ApiOperation({ summary: '获取成本记录列表（分页）' })
  @ApiOkResponse({ type: CostRecordListResponseDto })
  listRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCostRecordsQueryDto,
  ): Promise<CostRecordListResponseDto> {
    return this.costsService.listRecords(user, query);
  }

  @Get('stats')
  @RequirePermissions('cost:view')
  @ApiOperation({ summary: '获取成本统计' })
  @ApiOkResponse({ type: CostStatsResponseDto })
  getStats(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CostRecordStatsQueryDto,
  ): Promise<CostStatsResponseDto> {
    return this.costsService.getStats(user, query);
  }

  @Get('dashboard')
  @RequirePermissions('cost:view')
  @ApiOperation({ summary: '获取成本页仪表盘数据（汇总+分类+趋势）' })
  @ApiOkResponse({ type: CostDashboardResponseDto })
  getDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CostRecordStatsQueryDto,
  ): Promise<CostDashboardResponseDto> {
    return this.costsService.getDashboard(user, query);
  }

  @Get('report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取报表中心成本报表数据' })
  @ApiOkResponse({ type: CostReportResponseDto })
  async getReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CostReportQueryDto,
    @Res({ passthrough: true }) reply: { raw: ServerResponse },
  ): Promise<CostReportResponseDto | typeof reply> {
    if (query.format === 'csv') {
      // 与 business-analysis B1 修复一致：强制置 export 走套餐门控，
      // 避免无 reportExportEnabled 权限的账号借 format=csv 绕过导出校验。
      query.export = true;
      await this.costsService.streamReportCsv(reply.raw, user, query);
      return reply;
    }
    return this.costsService.getReport(user, query);
  }

  @Post(['records', ''])
  @RequirePermissions('cost:create')
  @ApiOperation({ summary: '新增成本记录' })
  @ApiCreatedResponse({ type: CostRecordResponseDto })
  createRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCostRecordDto,
  ): Promise<CostRecordResponseDto> {
    return this.costsService.createRecord(user, dto);
  }

  @Delete(['records/:id', ':id'])
  @RequirePermissions('cost:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除成本记录' })
  @ApiNoContentResponse({ description: '删除成功' })
  deleteRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) recordId: number,
  ): Promise<void> {
    return this.costsService.deleteRecord(user, recordId);
  }
}
