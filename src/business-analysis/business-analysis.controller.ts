import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { GetBusinessAnalysisQueryDto } from './dto/business-analysis-query.dto';
import { BusinessAnalysisResponseDto } from './dto/business-analysis-response.dto';
import { BusinessAnalysisService } from './business-analysis.service';

@ApiTags('BusinessAnalysis')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('business-analysis')
export class BusinessAnalysisController {
  constructor(
    private readonly businessAnalysisService: BusinessAnalysisService,
  ) {}

  @Get()
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取经营分析大屏数据' })
  @ApiOkResponse({
    description: '返回前端经营分析页面所需的汇总、趋势、品类、成本和排行数据',
    type: BusinessAnalysisResponseDto,
  })
  getAnalysis(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetBusinessAnalysisQueryDto,
  ): Promise<BusinessAnalysisResponseDto> {
    return this.businessAnalysisService.getAnalysis(request.user, query);
  }
}
