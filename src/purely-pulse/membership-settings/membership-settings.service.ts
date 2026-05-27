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
      price: dto.price,
    });
  }

  async updateQuarterly(
    user: AuthenticatedUser,
    dto: UpdateQuarterlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.accessService.ensureDeveloperOrThrow(user);
    return this.profileService.updatePlanSetting('quarterly', {
      price: dto.price,
    });
  }

  async updateYearly(
    user: AuthenticatedUser,
    dto: UpdateYearlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.accessService.ensureDeveloperOrThrow(user);
    return this.profileService.updatePlanSetting('yearly', {
      price: dto.price,
    });
  }

  async updateLifetime(
    user: AuthenticatedUser,
    dto: UpdateLifetimeMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.accessService.ensureDeveloperOrThrow(user);
    return this.profileService.updatePlanSetting('lifetime', {
      price: dto.price,
      validDays: dto.validDays,
    });
  }
}
