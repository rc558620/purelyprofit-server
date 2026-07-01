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
    const existingSettings = await listMembershipPlanSettingRecords(
      this.prisma,
    );

    const existingByPlanId = new Map<
      MembershipSettingPlanId,
      MembershipPlanSettingRecord
    >(existingSettings.map((setting) => [setting.planId, setting]));

    // 检查每个期望的 planId 是否都存在，而非仅判断数量
    // （避免 DB 有 4 条记录但 planId 不覆盖全部的情况）
    const missingPlanIds = MEMBERSHIP_SETTING_PLAN_ORDER.filter(
      (planId) => !existingByPlanId.has(planId),
    );

    if (missingPlanIds.length === 0) {
      // 按 MEMBERSHIP_SETTING_PLAN_ORDER 定义的顺序排列返回，
      // 不依赖 DB 查询结果的插入序
      return MEMBERSHIP_SETTING_PLAN_ORDER.map(
        (planId) => existingByPlanId.get(planId)!,
      );
    }

    // 仅对缺失的 planId 执行 upsert 补齐，不覆盖已有记录的用户修改值
    await Promise.all(
      missingPlanIds.map((planId) =>
        upsertMembershipPlanSettingRecord(this.prisma, {
          planId,
          createData: this.buildCreatePayload(planId),
          patch: {
            price: DEFAULT_MEMBERSHIP_PLAN_SETTINGS[planId].price,
            ...(DEFAULT_MEMBERSHIP_PLAN_SETTINGS[planId].validDays !== null
              ? {
                  validDays: DEFAULT_MEMBERSHIP_PLAN_SETTINGS[planId].validDays,
                }
              : {}),
          },
        }),
      ),
    );

    // 重新查询以获取完整且排序正确的列表
    const allSettings = await listMembershipPlanSettingRecords(this.prisma);
    const allByPlanId = new Map<
      MembershipSettingPlanId,
      MembershipPlanSettingRecord
    >(allSettings.map((setting) => [setting.planId, setting]));

    return MEMBERSHIP_SETTING_PLAN_ORDER.map(
      (planId) => allByPlanId.get(planId)!,
    );
  }

  async updatePlanSetting(
    planId: MembershipSettingPlanId,
    patch: MembershipPlanSettingPatch,
  ): Promise<MembershipPlanSettingItemDto> {
    const updatedSetting = await upsertMembershipPlanSettingRecord(
      this.prisma,
      {
        planId,
        createData: this.buildCreatePayload(planId),
        patch,
      },
    );

    return this.toSettingDto(updatedSetting);
  }

  toSettingDto(
    setting: MembershipPlanSettingRecord,
  ): MembershipPlanSettingItemDto {
    return {
      planId: setting.planId,
      planName: setting.planName,
      price: setting.price,
      priceDisplay: String(setting.price / 100),
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
