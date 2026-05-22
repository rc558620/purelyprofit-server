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
import { GetProfitDetailQueryDto } from './dto/profit-detail-query.dto';
import {
  ProfitDetailResponseDto,
  ProfitReportResponseDto,
} from './dto/profit-detail-response.dto';
import { ProfitDetailService } from './profit-detail.service';

@ApiTags('ProfitDetail')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('profit-detail')
export class ProfitDetailController {
  constructor(private readonly profitDetailService: ProfitDetailService) {}

  @Get('report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取报表中心利润报表数据' })
  @ApiOkResponse({
    description: '返回报表中心利润 Tab 所需的概况与商品排行数据',
    type: ProfitReportResponseDto,
  })
  getReport(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetProfitDetailQueryDto,
  ): Promise<ProfitReportResponseDto> {
    return this.profitDetailService.getReport(request.user, query);
  }

  @Get()
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取利润详情数据' })
  @ApiOkResponse({
    description: '返回利润详情页所需的总览、趋势、排行和成本结构数据',
    type: ProfitDetailResponseDto,
  })
  getProfitDetail(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetProfitDetailQueryDto,
  ): Promise<ProfitDetailResponseDto> {
    return this.profitDetailService.getProfitDetail(request.user, query);
  }
}
