import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  MembershipPlanSettingItemDto,
  MembershipSettingPlanId,
} from './dto/membership-settings.dto';
import {
  DEFAULT_MEMBERSHIP_PLAN_SETTINGS,
  MEMBERSHIP_SETTING_PLAN_ORDER,
} from './membership-settings.constants';
import {
  listMembershipPlanSettingRecords,
  upsertMembershipPlanSettingRecord,
} from './membership-settings.query';
import type {
  MembershipPlanSettingPatch,
  MembershipPlanSettingRecord,
} from './membership-settings.types';

@Injectable()
export class PulseMembershipSettingsProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async loadSettings(): Promise<MembershipPlanSettingRecord[]> {
    const existingSettings = await listMembershipPlanSettingRecords(this.prisma);

    const existingByPlanId = new Map<MembershipSettingPlanId, MembershipPlanSettingRecord>(
      existingSettings.map((setting) => [setting.planId, setting]),
    );

    if (existingByPlanId.size === MEMBERSHIP_SETTING_PLAN_ORDER.length) {
      return MEMBERSHIP_SETTING_PLAN_ORDER.map((planId) => {
        const setting = existingByPlanId.get(planId);
        if (!setting) {
          throw new Error(`Missing membership setting for ${planId}`);
        }
        return setting;
      });
    }

    return Promise.all(
      MEMBERSHIP_SETTING_PLAN_ORDER.map((planId) =>
        upsertMembershipPlanSettingRecord(this.prisma, {
          planId,
          createData: this.buildCreatePayload(planId),
          patch: {
            price: DEFAULT_MEMBERSHIP_PLAN_SETTINGS[planId].price,
            ...(DEFAULT_MEMBERSHIP_PLAN_SETTINGS[planId].validDays !== null
              ? { validDays: DEFAULT_MEMBERSHIP_PLAN_SETTINGS[planId].validDays }
              : {}),
          },
        }),
      ),
    );
  }

  async updatePlanSetting(
    planId: MembershipSettingPlanId,
    patch: MembershipPlanSettingPatch,
  ): Promise<MembershipPlanSettingItemDto> {
    const updatedSetting = await upsertMembershipPlanSettingRecord(this.prisma, {
      planId,
      createData: this.buildCreatePayload(planId),
      patch,
    });

    return this.toSettingDto(updatedSetting);
  }

  toSettingDto(
    setting: MembershipPlanSettingRecord,
  ): MembershipPlanSettingItemDto {
    return {
      planId: setting.planId,
      planName: setting.planName,
      price: setting.price,
      validDays: setting.validDays,
      updatedAt: setting.updatedAt.getTime(),
    };
  }

  private buildCreatePayload(
    planId: MembershipSettingPlanId,
  ): Prisma.MembershipPlanSettingCreateArgs['data'] {
    const defaultSetting = DEFAULT_MEMBERSHIP_PLAN_SETTINGS[planId];
    return {
      planId: defaultSetting.planId,
      planName: defaultSetting.planName,
      price: defaultSetting.price,
      originalPrice: defaultSetting.originalPrice,
      durationMonths: defaultSetting.durationMonths,
      validDays: defaultSetting.validDays,
    };
  }
}
