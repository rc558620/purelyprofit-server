import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { BusinessAnalysisResponseDto } from '../../dashboard/business-analysis/dto/business-analysis-response.dto';
import {
  GetPulseDashboardAnalysisQueryDto,
  GetPulseDashboardHomeQueryDto,
  GetPulseDashboardOverviewQueryDto,
  GetPulseDashboardStoresQueryDto,
} from './dto/pulse-dashboard-query.dto';
import {
  PulseDashboardHomeResponseDto,
  PulseDashboardOverviewResponseDto,
  PulseDashboardStoresResponseDto,
} from './dto/pulse-dashboard-response.dto';
import { PulseDashboardService } from './dashboard.service';

@ApiTags('PulseDashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/dashboard')
export class PulseDashboardController {
  constructor(private readonly pulseDashboardService: PulseDashboardService) {}

  @Get('home')
  @ApiOperation({
    summary: '获取 Home 页聚合数据（在线人数 / 合伙人快览 / 充值收入趋势 / 排行 TOP5）',
  })
  @ApiOkResponse({
    description:
      '返回 Pulse 管理端 Home 页所需的全量聚合数据，包含实时在线人数、合伙人统计、推广排行 TOP5、充值收入趋势及类型分布',
    type: PulseDashboardHomeResponseDto,
  })
  getHome(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetPulseDashboardHomeQueryDto,
  ): Promise<PulseDashboardHomeResponseDto> {
    return this.pulseDashboardService.getHome(request.user, query);
  }

  @Get('overview')
  @ApiOperation({ summary: '获取跨店经营总览（统计卡、销售趋势）' })
  @ApiOkResponse({
    description: '返回老板名下所有门店（或指定门店）的统计卡和销售趋势',
    type: PulseDashboardOverviewResponseDto,
  })
  getOverview(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetPulseDashboardOverviewQueryDto,
  ): Promise<PulseDashboardOverviewResponseDto> {
    return this.pulseDashboardService.getOverview(request.user, query);
  }

  @Get('stores')
  @ApiOperation({ summary: '获取各门店经营排行' })
  @ApiOkResponse({
    description: '返回老板名下所有门店的利润、收入、成本和订单数排行',
    type: PulseDashboardStoresResponseDto,
  })
  getStores(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetPulseDashboardStoresQueryDto,
  ): Promise<PulseDashboardStoresResponseDto> {
    return this.pulseDashboardService.getStores(request.user, query);
  }

  @Get('analysis')
  @ApiOperation({ summary: '获取单店经营分析大屏数据（Pulse 老板视角）' })
  @ApiOkResponse({
    description:
      '仅支持老板自有门店，单门店时自动选中，多门店需传 storeId 指定',
  })
  getAnalysis(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetPulseDashboardAnalysisQueryDto,
  ): Promise<BusinessAnalysisResponseDto> {
    return this.pulseDashboardService.getAnalysis(request.user, query);
  }
}
