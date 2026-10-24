import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { ServerResponse } from 'node:http';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommissionRecordsService } from './commission-records.service';
import {
  CommissionSummaryByEmployeeQueryDto,
  CommissionSummaryByEmployeeResponseDto,
  ListCommissionRecordsQueryDto,
  ListCommissionRecordsResponseDto,
} from './dto/commission-record.dto';

@ApiTags('CommissionRecords')
@ApiBearerAuth()
// 服务人员提成属非餐饮能力：提成记录仅在空间会话结账时生成，餐饮门店恒为空。
// 与权限集注释「非餐饮门店店长专用」对齐，避免餐饮门店建出永不生效的孤儿配置。
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('general')
@Controller('commission-records')
export class CommissionRecordsController {
  constructor(
    private readonly commissionRecordsService: CommissionRecordsService,
  ) {}

  @Get()
  @RequirePermissions('commission:view')
  @ApiOperation({
    summary: '查询提成明细分页（月份/服务人员/状态筛选），返回明细与汇总',
  })
  @ApiOkResponse({ type: ListCommissionRecordsResponseDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCommissionRecordsQueryDto,
  ): Promise<ListCommissionRecordsResponseDto> {
    return this.commissionRecordsService.list(user, query);
  }

  @Get('export')
  @RequirePermissions('commission:view')
  @ApiOperation({
    summary: '导出提成明细 CSV（当前筛选条件下全量，不分页）',
  })
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCommissionRecordsQueryDto,
    @Res({ passthrough: true }) reply: { raw: ServerResponse },
  ): Promise<typeof reply> {
    await this.commissionRecordsService.streamExportCsv(reply.raw, user, query);
    return reply;
  }

  @Get('summary')
  @RequirePermissions('commission:view')
  @ApiOperation({ summary: '查询员工某月已结账提成合计（工资弹窗回填）' })
  @ApiOkResponse({ type: CommissionSummaryByEmployeeResponseDto })
  summaryByEmployee(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CommissionSummaryByEmployeeQueryDto,
  ): Promise<CommissionSummaryByEmployeeResponseDto> {
    return this.commissionRecordsService.summaryByEmployee(user, query);
  }
}
