import {
  Body,
  Controller,
  Get,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
  CreateConsumptionDto,
  CreateRechargeDto,
  ListPointsRecordsQueryDto,
  ListRechargesQueryDto,
} from './dto/marketing-query.dto';
import {
  MarketingConsumptionDto,
  MarketingPointsRecordsResponseDto,
  MarketingRechargeDto,
  MarketingRechargesResponseDto,
} from './dto/marketing-response.dto';
import { MarketingService } from './marketing.service';

@ApiTags('营销中心')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing')
export class MarketingTransactionsController {
  constructor(private readonly marketingService: MarketingService) {}

  @Get('recharges')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '储值记录列表（可按顾客/日期筛选）' })
  @ApiOkResponse({ type: MarketingRechargesResponseDto })
  listRecharges(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRechargesQueryDto,
  ): Promise<MarketingRechargesResponseDto> {
    return this.marketingService.listRecharges(user, query);
  }

  @Post('recharges')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '顾客储值' })
  @ApiCreatedResponse({ type: MarketingRechargeDto })
  createRecharge(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRechargeDto,
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<MarketingRechargeDto> {
    return this.marketingService.createRecharge(user, storeId, dto);
  }

  @Get('points-records')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '积分流水列表（可按顾客/时间/类型筛选）' })
  @ApiOkResponse({ type: MarketingPointsRecordsResponseDto })
  listPointsRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPointsRecordsQueryDto,
  ): Promise<MarketingPointsRecordsResponseDto> {
    return this.marketingService.listPointsRecords(user, query);
  }

  @Post('consumptions')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '记录消费' })
  @ApiCreatedResponse({ type: MarketingConsumptionDto })
  createConsumption(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConsumptionDto,
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<MarketingConsumptionDto> {
    return this.marketingService.createConsumption(user, storeId, dto);
  }
}
