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
import {
  AllowLegacyOwnerAccess,
  RequirePermissions,
} from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  AdjustCustomerPointsDto,
  CreateCustomerDto,
  ListCustomerPointsRecordsQueryDto,
  ListCustomerRechargesQueryDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/marketing-query.dto';
import {
  MarketingConsumptionsResponseDto,
  MarketingCustomerDetailDto,
  MarketingCustomerDto,
  MarketingCustomersResponseDto,
  MarketingPointsRecordsResponseDto,
  MarketingRechargesResponseDto,
} from './dto/marketing-response.dto';
import { MarketingService } from './marketing.service';

@ApiTags('营销中心')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing/customers')
export class MarketingCustomersController {
  constructor(private readonly marketingService: MarketingService) {}

  @Get()
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '顾客列表' })
  @ApiOkResponse({ type: MarketingCustomersResponseDto })
  listCustomers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCustomersQueryDto,
  ): Promise<MarketingCustomersResponseDto> {
    return this.marketingService.listCustomers(user, query);
  }

  @Post()
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '新增顾客' })
  @ApiCreatedResponse({ type: MarketingCustomerDto })
  createCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomerDto,
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<MarketingCustomerDto> {
    return this.marketingService.createCustomer(user, storeId, dto);
  }

  @Get(':id')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '顾客详情（含近期储值/消费记录）' })
  @ApiOkResponse({ type: MarketingCustomerDetailDto })
  getCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MarketingCustomerDetailDto> {
    return this.marketingService.getCustomer(user, id);
  }

  @Patch(':id')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '修改顾客信息' })
  @ApiOkResponse({ type: MarketingCustomerDto })
  updateCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    return this.marketingService.updateCustomer(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('marketing:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除顾客' })
  @ApiNoContentResponse()
  deleteCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.marketingService.deleteCustomer(user, id);
  }

  @Get(':id/recharges')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '顾客储值记录列表' })
  @ApiOkResponse({ type: MarketingRechargesResponseDto })
  listCustomerRecharges(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListCustomerRechargesQueryDto,
  ): Promise<MarketingRechargesResponseDto> {
    return this.marketingService.listCustomerRecharges(user, id, query);
  }

  @Get(':id/points-records')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '顾客积分流水列表' })
  @ApiOkResponse({ type: MarketingPointsRecordsResponseDto })
  listCustomerPointsRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListCustomerPointsRecordsQueryDto,
  ): Promise<MarketingPointsRecordsResponseDto> {
    return this.marketingService.listCustomerPointsRecords(user, id, query);
  }

  @Get(':id/consumptions')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '顾客消费记录列表' })
  @ApiOkResponse({ type: MarketingConsumptionsResponseDto })
  listConsumptions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ): Promise<MarketingConsumptionsResponseDto> {
    return this.marketingService.listConsumptions(user, id, {
      page,
      pageSize,
    });
  }

  @Patch(':id/points')
  @RequirePermissions('marketing:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '调整顾客积分（影响 purelyClub C端用户）' })
  @ApiOkResponse({ type: MarketingCustomerDto })
  adjustCustomerPoints(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdjustCustomerPointsDto,
  ): Promise<MarketingCustomerDto> {
    return this.marketingService.adjustCustomerPoints(user, id, dto);
  }
}
