import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
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
import {
  AllowLegacyOwnerAccess,
  RequirePermissions,
} from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MarketingSharedService } from '../marketing-shared.service';
import { SmsBroadcastQueryService } from './sms-broadcast-query.service';
import { SmsBroadcastService } from './sms-broadcast.service';
import { SmsQuoteService } from './sms-quote.service';
import { SmsRechargeService } from './sms-recharge.service';
import { SmsWalletService } from './sms-wallet.service';
import {
  CreateSmsBroadcastDto,
  CreateSmsQuoteDto,
  CreateSmsRechargeOrderDto,
  SmsAccountResponseDto,
  SmsBroadcastListQueryDto,
  SmsBroadcastRecipientsQueryDto,
  SmsBroadcastRecipientsResponseDto,
  SmsBroadcastResponseDto,
  SmsBroadcastTaskDetailDto,
  SmsBroadcastTaskListResponseDto,
  SmsQuoteResponseDto,
  SmsRechargeOrderResponseDto,
  SmsRechargeOrderStatusDto,
  SmsRechargeTiersResponseDto,
  SmsWalletLogsQueryDto,
  SmsWalletLogsResponseDto,
  SmsWalletResponseDto,
} from './dto/sms.dto';

/**
 * 群发短信 / 短信钱包接口。
 *
 * 收件人列表**复用现有** `GET /api/marketing/customers`
 * （`status` 支持 new/active/dormant/lost，`pageSize` 上限已放开到 200），
 * 这里不新增收件人接口。
 */
@ApiTags('营销中心')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing/sms')
export class SmsController {
  constructor(
    private readonly marketingSharedService: MarketingSharedService,
    private readonly quoteService: SmsQuoteService,
    private readonly broadcastService: SmsBroadcastService,
    private readonly rechargeService: SmsRechargeService,
    private readonly walletService: SmsWalletService,
    private readonly broadcastQueryService: SmsBroadcastQueryService,
  ) {}

  @Get('account')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '短信账户余额与单价' })
  @ApiOkResponse({ type: SmsAccountResponseDto })
  async getAccount(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SmsAccountResponseDto> {
    const storeId = await this.resolveStoreId(user);
    const wallet = await this.walletService.getWallet(storeId);
    return {
      balanceFen: wallet.balanceFen,
      unitPriceFen: wallet.unitPriceFen,
    };
  }

  @Post('quote')
  @RequirePermissions('marketing:view')
  @ApiOperation({
    summary: '群发询价',
    description:
      '按收件人与正文计算计费条数与金额，不扣费。smsSegments = 每人分段数 × 有效收件人数（总条数）。',
  })
  @ApiOkResponse({ type: SmsQuoteResponseDto })
  async createQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSmsQuoteDto,
  ): Promise<SmsQuoteResponseDto> {
    const storeId = await this.resolveStoreId(user);
    return this.quoteService.createQuote(storeId, dto);
  }

  @Post('broadcasts')
  @RequirePermissions('marketing:manage')
  @ApiOperation({
    summary: '提交群发（先扣费后发送）',
    description:
      'idempotencyKey 唯一：钱包页支付成功回跳群发页续发时复用同一个 key，后端保证只发一次。发送失败不自动退费。',
  })
  @ApiCreatedResponse({ type: SmsBroadcastResponseDto })
  async createBroadcast(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSmsBroadcastDto,
  ): Promise<SmsBroadcastResponseDto> {
    const storeId = await this.resolveStoreId(user);
    // 操作人优先记员工身份（子账号/员工登录），没有则退回账号 ID
    const operatorStaffId = user.currentMembership?.staffId ?? user.id;
    return this.broadcastService.broadcast(storeId, operatorStaffId, dto);
  }

  @Post('recharge-orders')
  @RequirePermissions('marketing:manage')
  @ApiOperation({
    summary: '创建短信钱包充值订单（微信 Native 扫码支付）',
    description:
      '充值不带任何赠送：赠送由 purelyPulse 侧发放，计入 grant 流水。',
  })
  @ApiCreatedResponse({ type: SmsRechargeOrderResponseDto })
  async createRechargeOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSmsRechargeOrderDto,
  ): Promise<SmsRechargeOrderResponseDto> {
    const storeId = await this.resolveStoreId(user);
    return this.rechargeService.createRechargeOrder(storeId, dto.amountFen);
  }

  @Get('recharge-orders/:orderNo')
  @RequirePermissions('marketing:view')
  @ApiOperation({
    summary: '查询充值订单状态（前端 2s 轮询）',
    description: 'pending=待支付 paid=已支付 closed=已关闭 failed=失败',
  })
  @ApiOkResponse({ type: SmsRechargeOrderStatusDto })
  async getRechargeOrderStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNo') orderNo: string,
  ): Promise<SmsRechargeOrderStatusDto> {
    const storeId = await this.resolveStoreId(user);
    return this.rechargeService.getRechargeOrderStatus(storeId, orderNo);
  }

  @Get('wallet')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '短信钱包概览' })
  @ApiOkResponse({ type: SmsWalletResponseDto })
  async getWallet(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SmsWalletResponseDto> {
    const storeId = await this.resolveStoreId(user);
    return this.walletService.getWallet(storeId);
  }

  @Get('recharge-tiers')
  @RequirePermissions('marketing:view')
  @ApiOperation({
    summary: '充值档位（不含赠送）',
    description: 'amountDisplay 由后端下发，前端直接展示。',
  })
  @ApiOkResponse({ type: SmsRechargeTiersResponseDto })
  getRechargeTiers(): SmsRechargeTiersResponseDto {
    return this.walletService.getRechargeTiers();
  }

  @Get('wallet-logs')
  @RequirePermissions('marketing:view')
  @ApiOperation({
    summary: '短信钱包流水',
    description: 'changeFen 正数为入账、负数为出账。',
  })
  @ApiOkResponse({ type: SmsWalletLogsResponseDto })
  async listWalletLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SmsWalletLogsQueryDto,
  ): Promise<SmsWalletLogsResponseDto> {
    const storeId = await this.resolveStoreId(user);
    return this.walletService.listWalletLogs(storeId, query);
  }

  @Get('broadcasts')
  @RequirePermissions('marketing:view')
  @ApiOperation({
    summary: '群发任务列表',
    description:
      '按创建时间倒序返回历史群发与投递结果。发送失败的任务只能在这里看到，钱包流水里只有扣费金额。',
  })
  @ApiOkResponse({ type: SmsBroadcastTaskListResponseDto })
  async listBroadcasts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SmsBroadcastListQueryDto,
  ): Promise<SmsBroadcastTaskListResponseDto> {
    const storeId = await this.resolveStoreId(user);
    return this.broadcastQueryService.listBroadcasts(storeId, query);
  }

  @Get('broadcasts/:broadcastId')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '群发任务详情（含收件人投递结果首页）' })
  @ApiOkResponse({ type: SmsBroadcastTaskDetailDto })
  async getBroadcastDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('broadcastId') broadcastId: string,
  ): Promise<SmsBroadcastTaskDetailDto> {
    const storeId = await this.resolveStoreId(user);
    return this.broadcastQueryService.getBroadcastDetail(storeId, broadcastId);
  }

  @Get('broadcasts/:broadcastId/recipients')
  @RequirePermissions('marketing:view')
  @ApiOperation({
    summary: '群发收件人投递明细',
    description: 'status 传 failed 可只看没收到的人，便于人工核实与申请退费。',
  })
  @ApiOkResponse({ type: SmsBroadcastRecipientsResponseDto })
  async listBroadcastRecipients(
    @CurrentUser() user: AuthenticatedUser,
    @Param('broadcastId') broadcastId: string,
    @Query() query: SmsBroadcastRecipientsQueryDto,
  ): Promise<SmsBroadcastRecipientsResponseDto> {
    const storeId = await this.resolveStoreId(user);
    return this.broadcastQueryService.listRecipients(
      storeId,
      broadcastId,
      query,
    );
  }

  private async resolveStoreId(user: AuthenticatedUser): Promise<number> {
    const storeId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        undefined,
      );
    if (storeId === null) {
      throw new ForbiddenException('无权操作该门店的营销数据');
    }
    return storeId;
  }
}
