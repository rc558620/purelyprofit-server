import type { ApplyPlatformPartnerDto } from './dto/platform-membership-query.dto';
import type {
  PlatformMembershipPartnerApplicationDto,
  PlatformMembershipPartnerFollowUpNoteDto,
  PlatformMembershipPartnerProfileResponseDto,
} from './dto/platform-membership-response.dto';
import {
  buildApprovedPartnerResponse,
  buildApprovedPartnersResponse,
} from './platform-membership.domain';
import { buildPartnerLevel } from './platform-membership-promo.domain';
import type {
  PartnerSnapshotPayload,
  StoreMembershipPromoRecord,
  StorePartnerApplicationNoteRecord,
  StorePartnerApplicationRecord,
  StorePartnerRecord,
} from './platform-membership.types';

export function buildCurrentPartnerApplication(
  applications: StorePartnerApplicationRecord[],
  partners: StorePartnerRecord[],
): PlatformMembershipPartnerApplicationDto | null {
  const latestApplication = applications[0];
  if (latestApplication) {
    return mapPartnerApplicationRecord(
      latestApplication,
      findMatchedPartner(partners, latestApplication),
    );
  }

  return mapLegacyPartnerApplication(partners[0] ?? null);
}

export function buildPartnerApplications(
  applications: StorePartnerApplicationRecord[],
  partners: StorePartnerRecord[],
): PlatformMembershipPartnerApplicationDto[] {
  if (applications.length > 0) {
    return applications.map((application) =>
      mapPartnerApplicationRecord(
        application,
        findMatchedPartner(partners, application),
      ),
    );
  }

  const legacyApplication = mapLegacyPartnerApplication(partners[0] ?? null);
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
  partners: StorePartnerRecord[];
  promoRecords: StoreMembershipPromoRecord[];
  applications: StorePartnerApplicationRecord[];
}): PlatformMembershipPartnerProfileResponseDto {
  const primaryPartner = params.partners[0] ?? null;
  const currentApplication = buildCurrentPartnerApplication(
    params.applications,
    params.partners,
  );

  return {
    isPartner: params.partners.length > 0,
    currentApplication,
    applications: buildPartnerApplications(
      params.applications,
      params.partners,
    ),
    approvedPartner: buildApprovedPartnerResponse(primaryPartner),
    approvedPartners: buildApprovedPartnersResponse(params.partners),
    level: buildPartnerLevel(primaryPartner, params.promoRecords),
  };
}

function findMatchedPartner(
  partners: StorePartnerRecord[],
  applicant: Pick<StorePartnerApplicationRecord, 'idCard' | 'phone'>,
): StorePartnerRecord | null {
  const normalizedIdCard = applicant.idCard.trim().toUpperCase();
  const matchedByIdCard = partners.find(
    (partner) => partner.idCard?.trim().toUpperCase() === normalizedIdCard,
  );

  if (matchedByIdCard) {
    return matchedByIdCard;
  }

  return (
    partners.find(
      (partner) => partner.phone?.trim() === applicant.phone.trim(),
    ) ?? null
  );
}
