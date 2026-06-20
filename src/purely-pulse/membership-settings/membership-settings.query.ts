import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MembershipSettingPlanId } from './dto/membership-settings.dto';
import type {
  MembershipPlanSettingPatch,
  MembershipPlanSettingRecord,
} from './membership-settings.types';

export const MEMBERSHIP_PLAN_SETTING_SELECT = {
  planId: true,
  planName: true,
  price: true,
  validDays: true,
  updatedAt: true,
} satisfies Prisma.MembershipPlanSettingSelect;

type MembershipPlanSettingEntity = Prisma.MembershipPlanSettingGetPayload<{
  select: typeof MEMBERSHIP_PLAN_SETTING_SELECT;
}>;

export async function listMembershipPlanSettingRecords(
  prisma: PrismaService,
): Promise<MembershipPlanSettingRecord[]> {
  const settings = await prisma.membershipPlanSetting.findMany({
    select: MEMBERSHIP_PLAN_SETTING_SELECT,
    orderBy: {
      id: 'asc',
    },
  });

  return settings.map(toMembershipPlanSettingRecord);
}

export async function upsertMembershipPlanSettingRecord(
  prisma: PrismaService,
  params: {
    planId: MembershipSettingPlanId;
    createData: Prisma.MembershipPlanSettingCreateArgs['data'];
    patch: MembershipPlanSettingPatch;
  },
): Promise<MembershipPlanSettingRecord> {
  const setting = await prisma.membershipPlanSetting.upsert({
    where: { planId: params.planId },
    create: {
      ...params.createData,
      price: params.patch.price,
      ...(params.patch.planName !== undefined
        ? { planName: params.patch.planName }
        : {}),
      ...(params.patch.validDays !== undefined
        ? { validDays: params.patch.validDays }
        : {}),
    },
    update: {
      price: params.patch.price,
      ...(params.patch.planName !== undefined
        ? { planName: params.patch.planName }
        : {}),
      ...(params.patch.validDays !== undefined
        ? { validDays: params.patch.validDays }
        : {}),
    },
    select: MEMBERSHIP_PLAN_SETTING_SELECT,
  });

  return toMembershipPlanSettingRecord(setting);
}

function toMembershipPlanSettingRecord(
  setting: MembershipPlanSettingEntity,
): MembershipPlanSettingRecord {
  return {
    planId: setting.planId as MembershipSettingPlanId,
    planName: setting.planName,
    price: setting.price,
    validDays: setting.validDays,
    updatedAt: setting.updatedAt,
  };
}
