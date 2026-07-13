import type { ApplyPlatformPartnerDto } from './dto/platform-membership-query.dto';
import type {
  PlatformMembershipPartnerApplicationDto,
  PlatformMembershipPartnerFollowUpNoteDto,
  PlatformMembershipPartnerProfileResponseDto,
} from './dto/platform-membership-response.dto';
import { buildApprovedPartnerResponse } from './membership-profile.mapper';
import { buildPartnerLevel } from './platform-membership-promo.domain';
import {
  applicantIdentityKey,
  isSameApplicantIdentifier,
} from './platform-membership-partner-application.domain';
import type {
  PartnerSnapshotPayload,
  StoreMembershipPromoRecord,
  StorePartnerApplicationNoteRecord,
  StorePartnerApplicationRecord,
  StorePartnerRecord,
} from './platform-membership.types';

export function buildCurrentPartnerApplication(
  applications: StorePartnerApplicationRecord[],
  partner: StorePartnerRecord | null,
): PlatformMembershipPartnerApplicationDto | null {
  // 已是正式合伙人时，优先展示与该合伙人匹配的已通过申请，
  // 避免"合伙人已通过"与"最新一条被驳回/待审申请"在同一页面出现状态冲突
  if (partner && partner.status === 'approved') {
    const approvedApplication = findApprovedApplicationForPartner(
      applications,
      partner,
    );
    if (approvedApplication) {
      return mapPartnerApplicationRecord(approvedApplication, partner);
    }

    // 已通过合伙人但找不到匹配申请（历史脏数据/换号申请）时，直接以真实合伙人
    // 档案为主，确保 beanBalance 等来自合伙人账户，避免与最新一条不匹配的申请
    // 拼接导致余额错显为 0（见 B2）。
    return mapLegacyPartnerApplication(partner);
  }

  const latestApplication = applications[0];
  if (latestApplication) {
    return mapPartnerApplicationRecord(
      latestApplication,
      matchPartner(partner, latestApplication),
    );
  }

  return mapLegacyPartnerApplication(partner);
}

/**
 * 在申请列表中查找与当前合伙人匹配的已通过申请。
 * applications 已按 createdAt desc 排序，首个命中即为最新一条。
 */
function findApprovedApplicationForPartner(
  applications: StorePartnerApplicationRecord[],
  partner: StorePartnerRecord,
): StorePartnerApplicationRecord | null {
  return (
    applications.find(
      (application) =>
        application.status === 'approved' &&
        matchPartner(partner, application) !== null,
    ) ?? null
  );
}

/**
 * 按申请人去重（收口到 applicantIdentityKey），保留每个申请人最新的一条记录。
 * 输入列表已按 createdAt desc 排序，首次出现即为最新。
 */
export function deduplicateApplications(
  applications: StorePartnerApplicationRecord[],
): StorePartnerApplicationRecord[] {
  const seen = new Set<string>();
  const result: StorePartnerApplicationRecord[] = [];

  for (const app of applications) {
    const key = applicantIdentityKey(app);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(app);
    }
  }

  return result;
}

export function buildPartnerApplications(
  applications: StorePartnerApplicationRecord[],
  partner: StorePartnerRecord | null,
): PlatformMembershipPartnerApplicationDto[] {
  if (applications.length > 0) {
    return deduplicateApplications(applications).map((application) =>
      mapPartnerApplicationRecord(
        application,
        matchPartner(partner, application),
      ),
    );
  }

  const legacyApplication = mapLegacyPartnerApplication(partner);
  return legacyApplication ? [legacyApplication] : [];
}

export function mapPartnerApplicationRecord(
  application: StorePartnerApplicationRecord,
  partner: StorePartnerRecord | null,
): PlatformMembershipPartnerApplicationDto {
  return {
    id: String(application.id),
    name: application.name,
    phone: application.phone,
    idCard: application.idCard,
    ...(application.region.length > 0 ? { region: application.region } : {}),
    paymentMethod: application.paymentAccountType,
    paymentAccount: application.paymentAccountNo,
    intention: application.intention,
    status: application.status,
    createdAt: application.createdAt.getTime(),
    ...(application.reviewedAt
      ? { reviewedAt: application.reviewedAt.getTime() }
      : {}),
    ...(application.joinedAt
      ? { joinedAt: application.joinedAt.getTime() }
      : {}),
    ...(application.applyReason
      ? { applyReason: application.applyReason }
      : {}),
    followUpNotes: mapPartnerFollowUpNotes(application.followUpNotes),
    beanBalance: partner?.beanBalance ?? 0,
    totalEarnedBeans: partner?.totalEarnedBeans ?? 0,
    totalWithdrawnBeans: partner?.totalWithdrawnBeans ?? 0,
  };
}

export function mapLegacyPartnerApplication(
  partner: StorePartnerRecord | null,
): PlatformMembershipPartnerApplicationDto | null {
  if (!partner) {
    return null;
  }

  return {
    id: String(partner.id),
    name: partner.name ?? '',
    phone: partner.phone ?? '',
    idCard: partner.idCard ?? '',
    ...(partner.region.length > 0 ? { region: partner.region } : {}),
    paymentMethod: partner.paymentAccountType ?? 'wechat',
    paymentAccount: partner.paymentAccountNo ?? '',
    intention: partner.intention ?? 'agent',
    status: partner.status,
    createdAt: partner.createdAt.getTime(),
    ...(partner.reviewedAt ? { reviewedAt: partner.reviewedAt.getTime() } : {}),
    ...(partner.joinedAt ? { joinedAt: partner.joinedAt.getTime() } : {}),
    ...(partner.applyReason ? { applyReason: partner.applyReason } : {}),
    followUpNotes: [],
    beanBalance: partner.beanBalance,
    totalEarnedBeans: partner.totalEarnedBeans,
    totalWithdrawnBeans: partner.totalWithdrawnBeans,
  };
}

export function mapPartnerFollowUpNotes(
  notes: StorePartnerApplicationNoteRecord[],
): PlatformMembershipPartnerFollowUpNoteDto[] {
  return notes.map((note) => ({
    id: `partner-note-${note.id}`,
    content: note.content,
    createdAt: note.createdAt.getTime(),
  }));
}

export function buildPartnerApplicationPayload(
  dto: ApplyPlatformPartnerDto,
): PartnerSnapshotPayload {
  return {
    name: dto.name.trim(),
    phone: dto.phone.trim(),
    idCard: dto.idCard.trim().toUpperCase(),
    region: dto.region?.filter((value) => value.trim() !== '') ?? [],
    intention: dto.intention,
    applyReason: dto.applyReason?.trim() || null,
    paymentAccountType: dto.paymentMethod,
    paymentAccountNo: dto.paymentAccount.trim(),
    paymentAccountName: dto.name.trim(),
  };
}

export function buildPartnerProfileResponse(params: {
  partner: StorePartnerRecord | null;
  promoRecords: StoreMembershipPromoRecord[];
  applications: StorePartnerApplicationRecord[];
}): PlatformMembershipPartnerProfileResponseDto {
  const { partner } = params;
  const approved = buildApprovedPartnerResponse(partner);
  const currentApplication = buildCurrentPartnerApplication(
    params.applications,
    partner,
  );

  return {
    isPartner: partner !== null,
    currentApplication,
    applications: buildPartnerApplications(params.applications, partner),
    approvedPartner: approved,
    approvedPartners: approved ? [approved] : [],
    // partnerId 过滤已收口到 buildPartnerLevel 内部，这里直接透传即可
    level: buildPartnerLevel(partner, params.promoRecords),
  };
}

/** 单合伙人匹配：判断当前合伙人是否与申请人匹配（收口到统一同人判定） */
function matchPartner(
  partner: StorePartnerRecord | null,
  applicant: Pick<StorePartnerApplicationRecord, 'idCard' | 'phone'>,
): StorePartnerRecord | null {
  if (!partner) return null;
  return isSameApplicantIdentifier(partner, applicant) ? partner : null;
}
