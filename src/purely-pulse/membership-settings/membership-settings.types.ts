import type { MembershipSettingPlanId } from './dto/membership-settings.dto';

export interface DefaultMembershipPlanSetting {
  planId: MembershipSettingPlanId;
  planName: string;
  price: number;
  originalPrice: number | null;
  durationMonths: number | null;
  validDays: number | null;
}

export interface MembershipPlanSettingRecord {
  planId: MembershipSettingPlanId;
  planName: string;
  price: number;
  validDays: number | null;
  updatedAt: Date;
}

export interface MembershipPlanSettingPatch {
  price: number;
  validDays?: number;
}
