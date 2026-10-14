import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import {
  PulseAdminMemberPricingPreviewDto,
  PulseAdminMemberSubAccountAmountBackfillDto,
} from './dto/pulse-membership-admin-members.membership.request.dto';
import { PulseAdminRenewalPriceUpdateDto } from './dto/pulse-membership-admin-members.renewal-price.request.dto';
import { PulseAdminMemberPricingPreviewResponseDto } from './dto/pulse-membership-admin-pricing-preview.response.dto';
import { PulseAdminRenewalPriceResponseDto } from './dto/pulse-membership-admin-renewal-price.response.dto';
import { resolveAdminMemberId } from './membership-admin-request.utils';
import { PulseMembershipService } from './membership.service';

/** 会员管理 - 定价相关（成交价预览 / 续费价 / 成交价快照补录） */
@ApiTags('Pulse / Membership')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/membership/admin')
export class PulseMembershipAdminPricingController {
  constructor(
    private readonly pulseMembershipService: PulseMembershipService,
  ) {}

  @Post('members/:id/membership/pricing-preview')
  @ApiOperation({ summary: 'Pulse 会员管理会员成交价预览（只算不落库）' })
  @ApiCreatedResponse({
    description:
      '返回按当前输入算出的「下次续费价 / 当期应补金额」。' +
      '金额一律由后端计算并以展示字符串下发，前端不做任何金额运算。',
    type: PulseAdminMemberPricingPreviewResponseDto,
  })
  previewAdminMemberPricing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberPricingPreviewDto,
  ): Promise<PulseAdminMemberPricingPreviewResponseDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.previewAdminMemberPricing(
      user,
      memberId,
      {
        targetLevel: dto.level,
        priceDisplay: dto.priceDisplay,
        subAccountCount: dto.subAccountCount,
        subAccountAmountDisplay: dto.subAccountAmountDisplay,
      },
    );
  }

  @Get('members/:id/renewal-price')
  @ApiOperation({ summary: 'Pulse 读取会员各档位续费价现状' })
  @ApiOkResponse({
    description:
      '供「调整续费价格」弹窗使用：返回月 / 季 / 年 / 永久四个档位当前的配置价、' +
      '是否已覆盖、子账号加价与最终续费价。金额一律由后端算好并以展示字符串下发。',
    type: PulseAdminRenewalPriceResponseDto,
  })
  async listAdminMemberRenewalPrices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
  ): Promise<PulseAdminRenewalPriceResponseDto> {
    const memberId = resolveAdminMemberId(rawMemberId);
    const items =
      await this.pulseMembershipService.listAdminMemberRenewalPrices(
        user,
        memberId,
      );
    return { items };
  }

  @Patch('members/:id/renewal-price')
  @ApiOperation({ summary: 'Pulse 调整会员续费价格' })
  @ApiOkResponse({
    description:
      '为单个门店的指定档位议定基础价覆盖，改动后该门店在 purelyProfit 的' +
      '会员套餐页与会员中心立即按新价展示、下单也按新价结算。' +
      'priceDisplay 传空串即清除覆盖、恢复默认价。' +
      '只动覆盖价，不碰成交总额与子账号加价，与「设置会员等级」互不干扰。',
    type: PulseAdminRenewalPriceResponseDto,
  })
  async updateAdminMemberRenewalPrices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminRenewalPriceUpdateDto,
  ): Promise<PulseAdminRenewalPriceResponseDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    const items =
      await this.pulseMembershipService.updateAdminMemberRenewalPrices(
        user,
        memberId,
        // 未传（undefined）与显式传空串都表示「清除覆盖」，统一收敛成 null
        dto.items.map((item) => ({
          planId: item.planId,
          priceDisplay: item.priceDisplay ?? null,
        })),
      );
    return { items };
  }

  @Patch('members/:id/deal-price/sub-account')
  @ApiOperation({ summary: 'Pulse 补录 / 撤销会员子账号加价' })
  @ApiOkResponse({
    description:
      '只更新成交价快照里的子账号加价与数量，不改写成交总额。' +
      '不传加价即撤销补录，回退到 max(当前配置价, 成交总额) 的旧口径。',
    type: PulseMemberDetailDto,
  })
  backfillAdminMemberSubAccountAmount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') rawMemberId: string,
    @Body() dto: PulseAdminMemberSubAccountAmountBackfillDto,
  ): Promise<PulseMemberDetailDto> {
    const memberId = resolveAdminMemberId(rawMemberId, dto);
    return this.pulseMembershipService.backfillAdminMemberSubAccountAmount(
      user,
      memberId,
      {
        planId: dto.planId,
        subAccountAmountDisplay: dto.subAccountAmountDisplay,
        subAccountCount: dto.subAccountCount,
      },
    );
  }
}
