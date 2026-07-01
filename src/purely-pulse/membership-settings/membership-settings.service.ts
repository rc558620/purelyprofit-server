import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type {
  MembershipPlanSettingItemDto,
  MembershipSettingsResponseDto,
  UpdateLifetimeMembershipSettingDto,
  UpdateMonthlyMembershipSettingDto,
  UpdateQuarterlyMembershipSettingDto,
  UpdateYearlyMembershipSettingDto,
} from './dto/membership-settings.dto';
import { PulseMembershipSettingsAccessService } from './membership-settings-access.service';
import { PulseMembershipSettingsProfileService } from './membership-settings-profile.service';

const yuanDisplayToFen = (yuanDisplay: string): number => {
  const parsed = Number.parseFloat(yuanDisplay);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed * 100);
};

@Injectable()
export class PulseMembershipSettingsService {
  constructor(
    private readonly accessService: PulseMembershipSettingsAccessService,
    private readonly profileService: PulseMembershipSettingsProfileService,
  ) {}

  async getSettings(
    user: AuthenticatedUser,
  ): Promise<MembershipSettingsResponseDto> {
    this.accessService.ensureDeveloperOrThrow(user);
    const settings = await this.profileService.loadSettings();
    return {
      items: settings.map((setting) =>
        this.profileService.toSettingDto(setting),
      ),
    };
  }

  async updateMonthly(
    user: AuthenticatedUser,
    dto: UpdateMonthlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.accessService.ensureDeveloperOrThrow(user);
    return this.profileService.updatePlanSetting('monthly', {
      price: yuanDisplayToFen(dto.priceDisplay),
    });
  }

  async updateQuarterly(
    user: AuthenticatedUser,
    dto: UpdateQuarterlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.accessService.ensureDeveloperOrThrow(user);
    return this.profileService.updatePlanSetting('quarterly', {
      price: yuanDisplayToFen(dto.priceDisplay),
    });
  }

  async updateYearly(
    user: AuthenticatedUser,
    dto: UpdateYearlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.accessService.ensureDeveloperOrThrow(user);
    return this.profileService.updatePlanSetting('yearly', {
      price: yuanDisplayToFen(dto.priceDisplay),
    });
  }

  async updateLifetime(
    user: AuthenticatedUser,
    dto: UpdateLifetimeMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.accessService.ensureDeveloperOrThrow(user);
    return this.profileService.updatePlanSetting('lifetime', {
      price: yuanDisplayToFen(dto.priceDisplay),
      validDays: dto.validDays,
    });
  }
}
