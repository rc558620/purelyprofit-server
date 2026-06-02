import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { GetDashboardHomeOverviewQueryDto } from './dto/dashboard-home-query.dto';
import { DashboardHomeOverviewResponseDto } from './dto/dashboard-home-response.dto';
import { DashboardHomeService } from './dashboard-home.service';

@ApiTags('DashboardHome')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller(['dashboard/home', 'home'])
export class DashboardHomeController {
  constructor(private readonly dashboardHomeService: DashboardHomeService) {}

  @Get('overview')
  @RequirePermissions('report:view', 'operation-entry:view')
  @ApiOperation({ summary: '获取首页经营概览数据（兼容 home/overview 路由）' })
  @ApiOkResponse({
    description: '返回首页统计卡、销售趋势、最新动态和元信息',
    type: DashboardHomeOverviewResponseDto,
  })
  getOverview(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetDashboardHomeOverviewQueryDto,
  ): Promise<DashboardHomeOverviewResponseDto> {
    return this.dashboardHomeService.getOverview(request.user, query);
  }
}
