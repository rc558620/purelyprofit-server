import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { PulseJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { BusinessAnalysisResponseDto } from '../../purely-profit/dashboard/business-analysis/dto/business-analysis-response.dto';
import {
  GetPulseDashboardAnalysisQueryDto,
  GetPulseDashboardHomeQueryDto,
  GetPulseDashboardOverviewQueryDto,
  GetPulseDashboardStoresQueryDto,
  GetPulseRevenueDetailQueryDto,
} from './dto/pulse-dashboard-query.dto';
import { PulseDashboardHomeResponseDto } from './dto/pulse-dashboard-home.response.dto';
import {
  PulseDashboardOverviewResponseDto,
  PulseDashboardStoresResponseDto,
} from './dto/pulse-dashboard-overview.response.dto';
import { PulseRevenueDetailResponseDto } from './dto/pulse-dashboard-revenue-detail.response.dto';
import { PulseDashboardService } from './dashboard.service';

@ApiTags('Pulse / Dashboard')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/dashboard')
export class PulseDashboardController {
  constructor(private readonly pulseDashboardService: PulseDashboardService) {}

  @Get('home')
  @ApiOperation({
    summary: '获取 Pulse 平台总览首页聚合数据',
  })
  @ApiOkResponse({
    description:
      '返回 Pulse 平台总览首页所需的聚合数据，默认按开发者查看商家整体运营面理解，包含在线人数、合伙人统计、推广排行 TOP5、充值收入趋势及类型分布',
    type: PulseDashboardHomeResponseDto,
  })
  getHome(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseDashboardHomeQueryDto,
  ): Promise<PulseDashboardHomeResponseDto> {
    return this.pulseDashboardService.getHome(user, query);
  }

  @Get('overview')
  @ApiOperation({ summary: '获取目标商家经营总览的兼容接口' })
  @ApiOkResponse({
    description:
      '当前虽然沿用 overview 命名，但实际返回的是当前选中目标商家门店的单店经营观察数据。',
    type: PulseDashboardOverviewResponseDto,
  })
  getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseDashboardOverviewQueryDto,
  ): Promise<PulseDashboardOverviewResponseDto> {
    return this.pulseDashboardService.getOverview(user, query);
  }

  @Get('stores')
  @ApiOperation({ summary: '获取目标商家排行视图的兼容接口' })
  @ApiOkResponse({
    description:
      '当前虽然沿用 stores / 排行 命名，但实际仅返回当前选中目标商家门店的排行视图兼容数据。',
    type: PulseDashboardStoresResponseDto,
  })
  getStores(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseDashboardStoresQueryDto,
  ): Promise<PulseDashboardStoresResponseDto> {
    return this.pulseDashboardService.getStores(user, query);
  }

  @Get('analysis')
  @ApiOperation({ summary: '获取目标商家经营分析的兼容接口' })
  @ApiOkResponse({
    description:
      '当前返回当前选中目标商家门店的经营分析数据；传 storeId 时会切换到对应目标商家门店。该接口仍是目标商家观察态兼容实现。',
  })
  getAnalysis(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseDashboardAnalysisQueryDto,
  ): Promise<BusinessAnalysisResponseDto> {
    return this.pulseDashboardService.getAnalysis(user, query);
  }
}

@ApiTags('Pulse / Dashboard')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller(['pulse/dashboard/revenue-detail', 'revenue-detail'])
export class RevenueDetailController {
  constructor(private readonly pulseDashboardService: PulseDashboardService) {}

  @Get()
  @ApiOperation({
    summary: '获取 Pulse 平台充值收入明细',
  })
  @ApiOkResponse({
    description:
      '返回 Pulse 平台充值收入明细数据，包含趋势图、汇总、类型分布和充值记录列表',
    type: PulseRevenueDetailResponseDto,
  })
  getRevenueDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseRevenueDetailQueryDto,
  ): Promise<PulseRevenueDetailResponseDto> {
    return this.pulseDashboardService.getRevenueDetail(user, query);
  }
}
