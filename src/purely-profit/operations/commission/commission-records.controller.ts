import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
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
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('commission-records')
export class CommissionRecordsController {
  constructor(
    private readonly commissionRecordsService: CommissionRecordsService,
  ) {}

  @Get()
  @RequirePermissions('commission:view')
  @ApiOperation({
    summary: '查询提成明细分页（月份/技师/状态筛选），返回明细与汇总',
  })
  @ApiOkResponse({ type: ListCommissionRecordsResponseDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCommissionRecordsQueryDto,
  ): Promise<ListCommissionRecordsResponseDto> {
    return this.commissionRecordsService.list(user, query);
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
