import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  MembershipPlanSettingItemDto,
  MembershipSettingPlanId,
  MembershipSettingsResponseDto,
  UpdateLifetimeMembershipSettingDto,
  UpdateMonthlyMembershipSettingDto,
  UpdateQuarterlyMembershipSettingDto,
  UpdateYearlyMembershipSettingDto,
} from './dto/membership-settings.dto';

interface DefaultMembershipPlanSetting {
  planId: MembershipSettingPlanId;
  planName: string;
  price: number;
  originalPrice: number | null;
  durationMonths: number | null;
  validDays: number | null;
}

interface MembershipPlanSettingRecord {
  planId: MembershipSettingPlanId;
  planName: string;
  price: number;
  validDays: number | null;
  updatedAt: Date;
}

const DEFAULT_MEMBERSHIP_PLAN_SETTINGS: Record<
  MembershipSettingPlanId,
  DefaultMembershipPlanSetting
> = {
  monthly: {
    planId: 'monthly',
    planName: '月度会员',
    price: 3800,
    originalPrice: 3800,
    durationMonths: 1,
    validDays: null,
  },
  quarterly: {
    planId: 'quarterly',
    planName: '季度会员',
    price: 9900,
    originalPrice: 11400,
    durationMonths: 3,
    validDays: null,
  },
  yearly: {
    planId: 'yearly',
    planName: '年度会员',
    price: 36900,
    originalPrice: 45600,
    durationMonths: 12,
    validDays: null,
  },
  lifetime: {
    planId: 'lifetime',
    planName: '永久会员',
    price: 39800,
    originalPrice: null,
    durationMonths: null,
    validDays: 730,
  },
};

const MEMBERSHIP_SETTING_PLAN_ORDER: MembershipSettingPlanId[] = [
  'monthly',
  'quarterly',
  'yearly',
  'lifetime',
];

@Injectable()
export class PulseMembershipSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(
    user: AuthenticatedUser,
  ): Promise<MembershipSettingsResponseDto> {
    this.ensureDeveloperOrThrow(user);
    const settings = await this.loadSettings();
    return {
      items: settings.map((setting) => this.toSettingDto(setting)),
    };
  }

  async updateMonthly(
    user: AuthenticatedUser,
    dto: UpdateMonthlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.ensureDeveloperOrThrow(user);
    return this.updatePlanSetting('monthly', { price: dto.price });
  }

  async updateQuarterly(
    user: AuthenticatedUser,
    dto: UpdateQuarterlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.ensureDeveloperOrThrow(user);
    return this.updatePlanSetting('quarterly', { price: dto.price });
  }

  async updateYearly(
    user: AuthenticatedUser,
    dto: UpdateYearlyMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.ensureDeveloperOrThrow(user);
    return this.updatePlanSetting('yearly', { price: dto.price });
  }

  async updateLifetime(
    user: AuthenticatedUser,
    dto: UpdateLifetimeMembershipSettingDto,
  ): Promise<MembershipPlanSettingItemDto> {
    this.ensureDeveloperOrThrow(user);
    return this.updatePlanSetting('lifetime', {
      price: dto.price,
      validDays: dto.validDays,
    });
  }

  private async loadSettings(): Promise<MembershipPlanSettingRecord[]> {
    const existingSettings = await this.prisma.membershipPlanSetting.findMany({
      select: {
        planId: true,
        planName: true,
        price: true,
        validDays: true,
        updatedAt: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    const existingByPlanId = new Map(
      existingSettings.map((setting) => [
        setting.planId as MembershipSettingPlanId,
        {
          planId: setting.planId as MembershipSettingPlanId,
          planName: setting.planName,
          price: setting.price,
          validDays: setting.validDays,
          updatedAt: setting.updatedAt,
        },
      ]),
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

    const backfilledSettings = await Promise.all(
      MEMBERSHIP_SETTING_PLAN_ORDER.map((planId) =>
        this.prisma.membershipPlanSetting.upsert({
          where: { planId },
          create: this.buildCreatePayload(planId),
          update: {},
          select: {
            planId: true,
            planName: true,
            price: true,
            validDays: true,
            updatedAt: true,
          },
        }),
      ),
    );

    return backfilledSettings.map((setting) => ({
      planId: setting.planId as MembershipSettingPlanId,
      planName: setting.planName,
      price: setting.price,
      validDays: setting.validDays,
      updatedAt: setting.updatedAt,
    }));
  }

  private async updatePlanSetting(
    planId: MembershipSettingPlanId,
    patch: { price: number; validDays?: number },
  ): Promise<MembershipPlanSettingItemDto> {
    const updatedSetting = await this.prisma.membershipPlanSetting.upsert({
      where: { planId },
      create: {
        ...this.buildCreatePayload(planId),
        price: patch.price,
        ...(patch.validDays !== undefined ? { validDays: patch.validDays } : {}),
      },
      update: {
        price: patch.price,
        ...(patch.validDays !== undefined ? { validDays: patch.validDays } : {}),
      },
      select: {
        planId: true,
        planName: true,
        price: true,
        validDays: true,
        updatedAt: true,
      },
    });

    return this.toSettingDto({
      planId: updatedSetting.planId as MembershipSettingPlanId,
      planName: updatedSetting.planName,
      price: updatedSetting.price,
      validDays: updatedSetting.validDays,
      updatedAt: updatedSetting.updatedAt,
    });
  }

  private buildCreatePayload(planId: MembershipSettingPlanId): {
    planId: MembershipSettingPlanId;
    planName: string;
    price: number;
    originalPrice: number | null;
    durationMonths: number | null;
    validDays: number | null;
  } {
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

  private toSettingDto(
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

  private ensureDeveloperOrThrow(user: AuthenticatedUser): void {
    if (this.isDeveloper(user)) {
      return;
    }

    throw new ForbiddenException('仅 Pulse 开发者可维护会员套餐配置');
  }

  private isDeveloper(user: AuthenticatedUser): boolean {
    return user.isPulseDeveloper === true || user.pulseMode === 'developer';
  }
}
