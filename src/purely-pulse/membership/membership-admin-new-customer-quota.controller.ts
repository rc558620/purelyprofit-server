import {
  Body,
  Controller,
  Get,
  Param,
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
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { PulseJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  AdjustPulseAdminNewCustomerQuotaDto,
  GetPulseAdminNewCustomerQuotaStoresQueryDto,
} from './dto/pulse-membership-admin-new-customer-quota.request.dto';
import {
  PulseAdminNewCustomerQuotaStoreDto,
  PulseAdminNewCustomerQuotaStoresResponseDto,
} from './dto/pulse-membership-admin-new-customer-quota.response.dto';
import { PulseMembershipService } from './membership.service';

/** 会员管理 - 门店新客额度 */
@ApiTags('Pulse / Membership')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/membership/admin')
export class PulseMembershipAdminNewCustomerQuotaController {
  constructor(
    private readonly pulseMembershipService: PulseMembershipService,
  ) {}

  @Get('new-customer-quota/stores')
  @ApiOperation({ summary: '获取 Pulse 门店新客额度列表' })
  @ApiOkResponse({
    description:
      '返回当前用户可访问门店的新客额度现状（剩余额度 / 累计已服务新客），供 purelyPulse new-customer-quota 页面展示。',
    type: PulseAdminNewCustomerQuotaStoresResponseDto,
  })
  listAdminNewCustomerQuotaStores(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPulseAdminNewCustomerQuotaStoresQueryDto,
  ): Promise<PulseAdminNewCustomerQuotaStoresResponseDto> {
    return this.pulseMembershipService.listAdminNewCustomerQuotaStores(
      user,
      query,
    );
  }

  @Post('new-customer-quota/stores/:storeId/adjust')
  @ApiOperation({ summary: 'Pulse 增减门店新客额度' })
  @ApiCreatedResponse({
    description:
      '按增量调整目标门店的新客额度（正数发放 / 负数回收，余额不会低于 0）' +
      '并写入一条额度流水。调整后 purelyProfit 额度页与 purelyClub 的' +
      '新客下单闸门立即按新额度生效。',
    type: PulseAdminNewCustomerQuotaStoreDto,
  })
  adjustAdminNewCustomerQuota(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Body() dto: AdjustPulseAdminNewCustomerQuotaDto,
  ): Promise<PulseAdminNewCustomerQuotaStoreDto> {
    return this.pulseMembershipService.adjustAdminNewCustomerQuota(
      user,
      storeId,
      dto,
    );
  }
}
