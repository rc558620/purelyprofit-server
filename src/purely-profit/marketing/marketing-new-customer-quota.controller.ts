// 新用户额度配置接口：概览 / 充值档位 / 流水 / 微信支付充值
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { Throttle } from '@nestjs/throttler';
import {
  AllowLegacyOwnerAccess,
  RequirePermissions,
} from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { NewCustomerQuotaRechargeService } from '../member/new-customer-quota/new-customer-quota-recharge.service';
import { NewCustomerQuotaService } from '../member/new-customer-quota/new-customer-quota.service';
import {
  NewCustomerQuotaLogsDto,
  NewCustomerQuotaLogsQueryDto,
  NewCustomerQuotaOverviewDto,
  NewCustomerQuotaTiersDto,
  PlatformPaymentStatusDto,
  RechargeNewCustomerQuotaDto,
  RechargeNewCustomerQuotaResultDto,
} from './dto/marketing-new-customer-quota.dto';

@ApiTags('营销中心')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing')
export class MarketingNewCustomerQuotaController {
  constructor(
    private readonly quotaService: NewCustomerQuotaService,
    private readonly quotaRechargeService: NewCustomerQuotaRechargeService,
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
  // 每次下单都会真实调用微信 Native 接口，必须限频：
  // 否则重复点击或脚本会把微信下单接口刷穿，并留下一堆永不关闭的 pending 单
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({
    summary: '新用户额度充值下单',
    description:
      '测试模式直接到账并返回最新概览；真实模式返回微信支付二维码，需按 orderNo 轮询支付状态。',
  })
  @ApiOkResponse({ type: RechargeNewCustomerQuotaResultDto })
  async recharge(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RechargeNewCustomerQuotaDto,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<RechargeNewCustomerQuotaResultDto> {
    const resolvedStoreId = await this.resolveStoreId(user, storeId);

    const result = await this.quotaRechargeService.createRechargeOrder({
      storeId: resolvedStoreId,
      operatorUserId: user.id,
      amountFen: dto.amountFen,
    });

    return {
      mode: result.mode,
      orderNo: result.orderNo,
      codeUrl: result.codeUrl,
      qrCodeImageUrl: result.qrCodeImageUrl,
      amountFen: result.amountFen,
      expiresAt: result.expiresAt?.toISOString(),
      overview: result.overview,
    };
  }

  @Get('new-customer-quota/recharge-orders/:orderNo')
  @RequirePermissions('marketing:view')
  // 前端每 2 秒轮询一次，单店单笔就有约 30 次/分钟；全局默认按 IP 只给 100 次/分钟，
  // 连锁门店共用出口 IP 时会被正常轮询打成 429，这里单独放宽
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @ApiOperation({
    summary: '查询额度充值支付单状态',
    description:
      '真实模式扫码支付后前端轮询该接口；超时未付会被惰性置为 closed。',
  })
  @ApiOkResponse({ type: PlatformPaymentStatusDto })
  async getRechargeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNo') orderNo: string,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<PlatformPaymentStatusDto> {
    // 单号不是凭证：必须校验它确实属于当前账号有权限的门店
    const resolvedStoreId = await this.resolveStoreId(user, storeId);
    const status = await this.quotaRechargeService.getRechargeStatus(
      orderNo,
      resolvedStoreId,
    );
    return {
      status: status.status,
      paidAt: status.paidAt?.toISOString() ?? null,
    };
  }
}
