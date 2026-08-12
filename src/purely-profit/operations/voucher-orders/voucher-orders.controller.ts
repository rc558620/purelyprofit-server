// 商家端团购券订单管理控制器：分页列表 / 确认 / 拒绝 / 新订单语音播报开关（仅非餐饮门店）
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import {
  QueryVoucherOrdersDto,
  UpdateVoucherOrderVoiceSettingsDto,
  VoucherOrderListResponseDto,
  VoucherOrderVoiceSettingsDto,
} from './dto/voucher-order-management.dto';
import {
  VoucherOrderConfirmResult,
  VoucherOrderRejectResult,
  VoucherOrdersService,
} from './voucher-orders.service';
import { VoucherOrderVoiceSettingsService } from './voucher-order-voice-settings.service';

@ApiTags('PurelyProfit Voucher Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('general')
@Controller('profit/voucher-orders')
export class VoucherOrdersController {
  constructor(
    private readonly voucherOrdersService: VoucherOrdersService,
    private readonly voiceSettingsService: VoucherOrderVoiceSettingsService,
  ) {}

  @Get('manage')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取当前门店团购券订单分页列表（按下单时间倒序）' })
  @ApiOkResponse({
    description: '返回团购券订单列表与总数',
    type: VoucherOrderListResponseDto,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryVoucherOrdersDto,
  ): Promise<VoucherOrderListResponseDto> {
    return this.voucherOrdersService.listVoucherOrders(user, query);
  }

  @Post(':orderNo/confirm')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({
    summary: '确认团购券订单：仅记录确认时间与操作员，订单状态保持不变',
  })
  @ApiCreatedResponse({
    description: '确认成功，返回确认时间与操作员快照',
  })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNo') orderNo: string,
  ): Promise<VoucherOrderConfirmResult> {
    return this.voucherOrdersService.confirmVoucherOrder(user, orderNo);
  }

  @Post(':orderNo/reject')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({
    summary:
      '拒绝团购券订单：走退款链路（原路退回 + 积分返还），状态变为已退款',
  })
  @ApiCreatedResponse({
    description: '拒绝成功，订单已退款',
  })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNo') orderNo: string,
  ): Promise<VoucherOrderRejectResult> {
    return this.voucherOrdersService.rejectVoucherOrder(user, orderNo);
  }

  @Get('voice-settings')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取门店团购券新订单语音播报开关' })
  @ApiOkResponse({
    description: '返回语音播报开关状态',
    type: VoucherOrderVoiceSettingsDto,
  })
  getVoiceSettings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VoucherOrderVoiceSettingsDto> {
    return this.voiceSettingsService.getForMerchant(user);
  }

  @Patch('voice-settings')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({ summary: '更新门店团购券新订单语音播报开关（支持部分更新）' })
  @ApiOkResponse({
    description: '更新成功，返回最新开关状态',
    type: VoucherOrderVoiceSettingsDto,
  })
  updateVoiceSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateVoucherOrderVoiceSettingsDto,
  ): Promise<VoucherOrderVoiceSettingsDto> {
    return this.voiceSettingsService.updateForMerchant(user, dto);
  }
}
