import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CreateConsumptionDto,
  CreateCustomerDto,
  CreatePromotionDto,
  CreateRechargeDto,
  ListCustomerPointsRecordsQueryDto,
  ListCustomerRechargesQueryDto,
  ListCustomersQueryDto,
  ListPointsRecordsQueryDto,
  ListPromotionsQueryDto,
  ListRechargesQueryDto,
  UpdateCustomerDto,
  UpdatePromotionDto,
} from './dto/marketing-query.dto';

import {
  MarketingConsumptionDto,
  MarketingConsumptionsResponseDto,
  MarketingCustomerDetailDto,
  MarketingCustomerDto,
  MarketingCustomersResponseDto,
  MarketingOverviewDto,
  MarketingPointsRecordsResponseDto,
  MarketingPromotionDto,
  MarketingPromotionsResponseDto,
  MarketingRechargeDto,
  MarketingRechargesResponseDto,
} from './dto/marketing-response.dto';
import { MarketingService } from './marketing.service';

@ApiTags('营销中心')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketingService: MarketingService) {}

  // ── Overview ────────────────────────────────────────────────────────

  @Get('overview')
  @ApiOperation({ summary: '营销概览数据' })
  @ApiOkResponse({ type: MarketingOverviewDto })
  async getOverview(
    @Req() req: { user: AuthenticatedUser },
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<MarketingOverviewDto> {
    return this.marketingService.getOverview(req.user, storeId);
  }

  // ── Customers ───────────────────────────────────────────────────────

  @Get('customers')
  @ApiOperation({ summary: '顾客列表' })
  @ApiOkResponse({ type: MarketingCustomersResponseDto })
  async listCustomers(
    @Req() req: { user: AuthenticatedUser },
    @Query() query: ListCustomersQueryDto,
  ): Promise<MarketingCustomersResponseDto> {
    return this.marketingService.listCustomers(req.user, query);
  }

  @Post('customers')
  @ApiOperation({ summary: '新增顾客' })
  @ApiCreatedResponse({ type: MarketingCustomerDto })
  async createCustomer(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CreateCustomerDto,
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<MarketingCustomerDto> {
    return this.marketingService.createCustomer(req.user, storeId, dto);
  }

  @Get('customers/:id')
  @ApiOperation({ summary: '顾客详情（含近期储值/消费记录）' })
  @ApiOkResponse({ type: MarketingCustomerDetailDto })
  async getCustomer(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MarketingCustomerDetailDto> {
    return this.marketingService.getCustomer(req.user, id);
  }

  @Patch('customers/:id')
  @ApiOperation({ summary: '修改顾客信息' })
  @ApiOkResponse({ type: MarketingCustomerDto })
  async updateCustomer(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    return this.marketingService.updateCustomer(req.user, id, dto);
  }

  @Delete('customers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除顾客' })
  @ApiNoContentResponse()
  async deleteCustomer(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.marketingService.deleteCustomer(req.user, id);
  }

  @Get('customers/:id/recharges')
  @ApiOperation({ summary: '顾客储值记录列表' })
  @ApiOkResponse({ type: MarketingRechargesResponseDto })
  async listCustomerRecharges(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListCustomerRechargesQueryDto,
  ): Promise<MarketingRechargesResponseDto> {
    return this.marketingService.listCustomerRecharges(req.user, id, query);
  }

  @Get('customers/:id/points-records')
  @ApiOperation({ summary: '顾客积分流水列表' })
  @ApiOkResponse({ type: MarketingPointsRecordsResponseDto })
  async listCustomerPointsRecords(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListCustomerPointsRecordsQueryDto,
  ): Promise<MarketingPointsRecordsResponseDto> {
    return this.marketingService.listCustomerPointsRecords(req.user, id, query);
  }

  // ── Consumptions (per customer) ─────────────────────────────────────

  @Get('customers/:id/consumptions')
  @ApiOperation({ summary: '顾客消费记录列表' })
  @ApiOkResponse({ type: MarketingConsumptionsResponseDto })
  async listConsumptions(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ): Promise<MarketingConsumptionsResponseDto> {
    return this.marketingService.listConsumptions(req.user, id, {
      page,
      pageSize,
    });
  }

  @Post('consumptions')
  @ApiOperation({ summary: '记录消费' })
  @ApiCreatedResponse({ type: MarketingConsumptionDto })
  async createConsumption(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CreateConsumptionDto,
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<MarketingConsumptionDto> {
    return this.marketingService.createConsumption(req.user, storeId, dto);
  }

  // ── Recharges ───────────────────────────────────────────────────────

  @Get('recharges')
  @ApiOperation({ summary: '储值记录列表（可按顾客/日期筛选）' })
  @ApiOkResponse({ type: MarketingRechargesResponseDto })
  async listRecharges(
    @Req() req: { user: AuthenticatedUser },
    @Query() query: ListRechargesQueryDto,
  ): Promise<MarketingRechargesResponseDto> {
    return this.marketingService.listRecharges(req.user, query);
  }

  @Post('recharges')
  @ApiOperation({ summary: '顾客储值' })
  @ApiCreatedResponse({ type: MarketingRechargeDto })
  async createRecharge(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CreateRechargeDto,
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<MarketingRechargeDto> {
    return this.marketingService.createRecharge(req.user, storeId, dto);
  }

  @Get('points-records')
  @ApiOperation({ summary: '积分流水列表（可按顾客/时间/类型筛选）' })
  @ApiOkResponse({ type: MarketingPointsRecordsResponseDto })
  async listPointsRecords(
    @Req() req: { user: AuthenticatedUser },
    @Query() query: ListPointsRecordsQueryDto,
  ): Promise<MarketingPointsRecordsResponseDto> {
    return this.marketingService.listPointsRecords(req.user, query);
  }

  // ── Promotions ───────────────────────────────────────────────────────

  @Get('promotions')
  @ApiOperation({ summary: '活动列表' })
  @ApiOkResponse({ type: MarketingPromotionsResponseDto })
  async listPromotions(
    @Req() req: { user: AuthenticatedUser },
    @Query() query: ListPromotionsQueryDto,
  ): Promise<MarketingPromotionsResponseDto> {
    return this.marketingService.listPromotions(req.user, query);
  }

  @Post('promotions')
  @ApiOperation({ summary: '创建活动' })
  @ApiCreatedResponse({ type: MarketingPromotionDto })
  async createPromotion(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CreatePromotionDto,
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<MarketingPromotionDto> {
    return this.marketingService.createPromotion(req.user, storeId, dto);
  }

  @Get('promotions/:id')
  @ApiOperation({ summary: '活动详情' })
  @ApiOkResponse({ type: MarketingPromotionDto })
  async getPromotion(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MarketingPromotionDto> {
    return this.marketingService.getPromotion(req.user, id);
  }

  @Patch('promotions/:id')
  @ApiOperation({ summary: '编辑活动' })
  @ApiOkResponse({ type: MarketingPromotionDto })
  async updatePromotion(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePromotionDto,
  ): Promise<MarketingPromotionDto> {
    return this.marketingService.updatePromotion(req.user, id, dto);
  }

  @Patch('promotions/:id/toggle')
  @ApiOperation({ summary: '上架/下架活动' })
  @ApiOkResponse({ type: MarketingPromotionDto })
  async togglePromotion(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
    @Body('enabled') enabled: boolean,
  ): Promise<MarketingPromotionDto> {
    return this.marketingService.togglePromotion(req.user, id, enabled);
  }

  @Delete('promotions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除活动' })
  @ApiNoContentResponse()
  async deletePromotion(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.marketingService.deletePromotion(req.user, id);
  }
}
