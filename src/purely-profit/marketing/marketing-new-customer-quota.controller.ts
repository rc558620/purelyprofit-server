// 新用户额度配置接口：概览 / 充值档位 / 流水 / 微信支付充值
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { NewCustomerQuotaService } from '../member/new-customer-quota/new-customer-quota.service';
import {
  NewCustomerQuotaLogsDto,
  NewCustomerQuotaLogsQueryDto,
  NewCustomerQuotaOverviewDto,
  NewCustomerQuotaTiersDto,
  RechargeNewCustomerQuotaDto,
} from './dto/marketing-new-customer-quota.dto';

@ApiTags('营销中心')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing')
export class MarketingNewCustomerQuotaController {
  constructor(
    private readonly quotaService: NewCustomerQuotaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 统一解析当前门店：无门店权限时抛 403 */
  private resolveStoreId(
    user: AuthenticatedUser,
    requestedStoreId: number | undefined,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      requestedStoreId,
      'marketing:view',
      '无权查看该门店的新用户额度',
    );
  }

  @Get('new-customer-quota/overview')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '新用户额度概览' })
  @ApiOkResponse({ type: NewCustomerQuotaOverviewDto })
  async getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<NewCustomerQuotaOverviewDto> {
    const resolvedStoreId = await this.resolveStoreId(user, storeId);
    return this.quotaService.getOverview(resolvedStoreId);
  }

  @Get('new-customer-quota/tiers')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '新用户额度充值档位（金额与新客数均由后端计算）' })
  @ApiOkResponse({ type: NewCustomerQuotaTiersDto })
  getTiers(): NewCustomerQuotaTiersDto {
    return { tiers: this.quotaService.getTiers() };
  }

  @Get('new-customer-quota/logs')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '新用户额度流水' })
  @ApiOkResponse({ type: NewCustomerQuotaLogsDto })
  async getLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
    @Query() query?: NewCustomerQuotaLogsQueryDto,
  ): Promise<NewCustomerQuotaLogsDto> {
    const resolvedStoreId = await this.resolveStoreId(user, storeId);
    const items = await this.quotaService.getLogs(
      resolvedStoreId,
      query?.pageSize,
    );
    return { items };
  }

  @Post('new-customer-quota/recharge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '新用户额度充值（微信支付）' })
  @ApiOkResponse({ type: NewCustomerQuotaOverviewDto })
  async recharge(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RechargeNewCustomerQuotaDto,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<NewCustomerQuotaOverviewDto> {
    const resolvedStoreId = await this.resolveStoreId(user, storeId);
    return this.quotaService.recharge(resolvedStoreId, dto.amountFen);
  }
}
