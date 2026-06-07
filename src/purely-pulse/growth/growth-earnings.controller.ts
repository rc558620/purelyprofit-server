import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { JwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  GetPulseEarningsLogsQueryDto,
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
} from './dto/pulse-growth-earnings.dto';
import { PulseGrowthService } from './growth.service';

@ApiTags('Pulse - Growth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/growth/earnings')
export class PulseGrowthEarningsController {
  constructor(private readonly growthService: PulseGrowthService) {}

  @Get('overview')
  @ApiOperation({ summary: '获取目标商家收益总览的兼容接口' })
  @ApiOkResponse({
    description: '当前仍返回目标商家收益中心的兼容数据',
    type: PulseEarningsOverviewResponseDto,
  })
  getOverview(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PulseEarningsOverviewResponseDto> {
    return this.growthService.getEarningsOverview(user);
  }

  @Get('logs')
  @ApiOperation({ summary: '获取目标商家收益流水的兼容接口' })
  @ApiOkResponse({
    description: '当前仍返回目标商家收益流水的兼容数据',
    type: PulseEarningsLogsResponseDto,
  })
  getLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseEarningsLogsQueryDto,
  ): Promise<PulseEarningsLogsResponseDto> {
    return this.growthService.getEarningsLogs(user, query);
  }
}
