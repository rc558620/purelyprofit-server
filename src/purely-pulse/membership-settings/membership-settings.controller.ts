import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { PulseJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  MembershipPlanSettingItemDto,
  MembershipSettingsResponseDto,
  UpdateLifetimeMembershipSettingDto,
  UpdateMonthlyMembershipSettingDto,
  UpdateQuarterlyMembershipSettingDto,
  UpdateYearlyMembershipSettingDto,
} from './dto/membership-settings.dto';
import { PulseMembershipSettingsService } from './membership-settings.service';

@ApiTags('Pulse / Membership Settings')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/membership-settings')
export class PulseMembershipSettingsController {
  constructor(
    private readonly pulseMembershipSettingsService: PulseMembershipSettingsService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取 Pulse 会员套餐配置' })
  @ApiOkResponse({
    description: '返回月度、季度、年度、永久会员的当前配置',
    type: MembershipSettingsResponseDto,
  })
  getSettings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MembershipSettingsResponseDto> {
    return this.pulseMembershipSettingsService.getSettings(user);
  }

  @Patch('monthly')
  @ApiOperation({ summary: '更新月度会员价格' })
  @ApiOkResponse({
    description: '更新成功并返回最新月度会员配置',
    type: MembershipPlanSettingItemDto,
  })
  updateMonthly(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMonthlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    return this.pulseMembershipSettingsService.updateMonthly(user, dto);
  }

  @Patch('quarterly')
  @ApiOperation({ summary: '更新季度会员价格' })
  @ApiOkResponse({
    description: '更新成功并返回最新季度会员配置',
    type: MembershipPlanSettingItemDto,
  })
  updateQuarterly(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateQuarterlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    return this.pulseMembershipSettingsService.updateQuarterly(user, dto);
  }

  @Patch('yearly')
  @ApiOperation({ summary: '更新年度会员价格' })
  @ApiOkResponse({
    description: '更新成功并返回最新年度会员配置',
    type: MembershipPlanSettingItemDto,
  })
  updateYearly(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateYearlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    return this.pulseMembershipSettingsService.updateYearly(user, dto);
  }

  @Patch('lifetime')
  @ApiOperation({ summary: '更新永久会员价格与有效期' })
  @ApiOkResponse({
    description: '更新成功并返回最新永久会员配置',
    type: MembershipPlanSettingItemDto,
  })
  updateLifetime(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateLifetimeMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    return this.pulseMembershipSettingsService.updateLifetime(user, dto);
  }
}
