import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  UpdateMarketingMemberLevelDto,
  UpdateMarketingPointsRatioDto,
  isMarketingMemberLevelId,
} from './dto/marketing-query.dto';
import {
  MarketingMemberLevelDto,
  MarketingMemberLevelSettingsDto,
  MarketingOverviewDto,
  MarketingPointsRatioDto,
} from './dto/marketing-response.dto';
import { MarketingService } from './marketing.service';

@ApiTags('营销中心')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing')
export class MarketingOverviewController {
  constructor(private readonly marketingService: MarketingService) {}

  @Get('overview')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '营销概览数据' })
  @ApiOkResponse({ type: MarketingOverviewDto })
  getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<MarketingOverviewDto> {
    return this.marketingService.getOverview(user, storeId);
  }

  @Get('member-level-settings')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '营销会员等级与积分规则配置' })
  @ApiOkResponse({ type: MarketingMemberLevelSettingsDto })
  getMemberLevelSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<MarketingMemberLevelSettingsDto> {
    return this.marketingService.getMemberLevelSettings(user, storeId);
  }

  @Patch('member-level-settings/levels/:levelId')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '更新营销会员等级配置' })
  @ApiOkResponse({ type: MarketingMemberLevelDto })
  updateMemberLevel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('levelId') levelId: string,
    @Body() dto: UpdateMarketingMemberLevelDto,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<MarketingMemberLevelDto> {
    if (!isMarketingMemberLevelId(levelId)) {
      throw new BadRequestException('无效的会员等级 ID');
    }
    return this.marketingService.updateMemberLevel(user, levelId, dto, storeId);
  }

  @Patch('member-level-settings/points-ratio')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '更新营销积分规则配置' })
  @ApiOkResponse({ type: MarketingPointsRatioDto })
  updatePointsRatio(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMarketingPointsRatioDto,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<MarketingPointsRatioDto> {
    return this.marketingService.updatePointsRatio(user, dto, storeId);
  }
}
