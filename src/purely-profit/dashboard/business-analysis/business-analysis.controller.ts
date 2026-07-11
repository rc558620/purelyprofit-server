import { CurrentUser } from '../../auth/current-user.decorator';
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
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
  async getAnalysis(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetBusinessAnalysisQueryDto,
    @Res({ passthrough: true }) reply: { raw: ServerResponse },
  ): Promise<BusinessAnalysisResponseDto | typeof reply> {
    if (query.format === 'csv') {
      // 与 inventory 模块 D1 修复保持一致：CSV 导出强制走 export 权限门控，
      // 防止拥有 report:view 但套餐不支持导出的账号借 format=csv 绕过
      // reportExportEnabled 校验；同时该路径不命中缓存，导出的是实时数据（顺带解决缓存陈旧问题）。
      query.export = true;
      await this.businessAnalysisService.streamReportCsv(
        reply.raw,
        user,
        query,
      );
      return reply;
    }
    return this.businessAnalysisService.getAnalysis(user, query);
  }
}
