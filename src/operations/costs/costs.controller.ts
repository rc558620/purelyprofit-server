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
import { CostsService } from './costs.service';
import {
  CostRecordStatsQueryDto,
  CostReportQueryDto,
  CreateCostRecordDto,
  ListCostRecordsQueryDto,
} from './dto/costs-query.dto';
import {
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
  @ApiOperation({ summary: '获取成本记录列表' })
  @ApiOkResponse({ type: [CostRecordResponseDto] })
  listRecords(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListCostRecordsQueryDto,
  ): Promise<CostRecordResponseDto[]> {
    return this.costsService.listRecords(request.user, query);
  }

  @Get('stats')
  @RequirePermissions('cost:view')
  @ApiOperation({ summary: '获取成本统计' })
  @ApiOkResponse({ type: CostStatsResponseDto })
  getStats(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: CostRecordStatsQueryDto,
  ): Promise<CostStatsResponseDto> {
    return this.costsService.getStats(request.user, query);
  }

  @Get('report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取报表中心成本报表数据' })
  @ApiOkResponse({ type: CostReportResponseDto })
  getReport(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: CostReportQueryDto,
  ): Promise<CostReportResponseDto> {
    return this.costsService.getReport(request.user, query);
  }

  @Post(['records', ''])
  @RequirePermissions('cost:create')
  @ApiOperation({ summary: '新增成本记录' })
  @ApiCreatedResponse({ type: CostRecordResponseDto })
  createRecord(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateCostRecordDto,
  ): Promise<CostRecordResponseDto> {
    return this.costsService.createRecord(request.user, dto);
  }

  @Delete(['records/:id', ':id'])
  @RequirePermissions('cost:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除成本记录' })
  @ApiNoContentResponse({ description: '删除成功' })
  deleteRecord(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) recordId: number,
  ): Promise<void> {
    return this.costsService.deleteRecord(request.user, recordId);
  }
}
