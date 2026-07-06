import type {
  PartnerSnapshotPayload,
  PrismaExecutor,
  StorePartnerApplicationRecord,
  StorePartnerRecord,
} from './platform-membership.types';
import { findStorePartnerByApplicant } from './platform-membership.query';

export function findBlockingApplication(
  applications: StorePartnerApplicationRecord[],
  payload: PartnerSnapshotPayload,
): StorePartnerApplicationRecord | null {
  return (
    applications.find(
      (application) =>
        isSameApplicant(application, payload) &&
        (application.status === 'pending' ||
          application.status === 'reviewing' ||
          application.status === 'approved'),
    ) ?? null
  );
}

export function hasApprovedPartnerForApplicant(
  partner: StorePartnerRecord | null,
  payload: PartnerSnapshotPayload,
): boolean {
  return partner !== null && isSameApplicant(partner, payload);
}

export function isSameApplicant(
  applicant:
    | Pick<StorePartnerApplicationRecord, 'idCard' | 'phone'>
    | Pick<StorePartnerRecord, 'idCard' | 'phone'>,
  payload: Pick<PartnerSnapshotPayload, 'idCard' | 'phone'>,
): boolean {
  const applicantIdCard = applicant.idCard?.trim().toUpperCase();
  const payloadIdCard = payload.idCard?.trim().toUpperCase();

  // 双方都有身份证时，仅以身份证为准
  if (applicantIdCard && payloadIdCard) {
    return applicantIdCard === payloadIdCard;
  }

  // 任一方无身份证时，回退到手机号
  const applicantPhone = applicant.phone?.trim();
  const payloadPhone = payload.phone?.trim();

  if (applicantPhone && payloadPhone) {
    return applicantPhone === payloadPhone;
  }

  return false;
}

export async function upsertApprovedPartnerSnapshot(params: {
  prismaExecutor: PrismaExecutor;
  storeId: number;
  application: StorePartnerApplicationRecord;
  approvedAt: Date;
}): Promise<void> {
  const payload = toPartnerSnapshotPayload(params.application);
  const existingPartner = await findStorePartnerByApplicant(
    params.prismaExecutor,
    params.storeId,
    payload,
  );

  if (existingPartner) {
    await params.prismaExecutor.storePartner.update({
      where: { id: existingPartner.id },
      data: {
        ...payload,
        status: 'approved',
        reviewedAt: params.approvedAt,
        joinedAt: params.approvedAt,
      },
    });
    return;
  }

  await params.prismaExecutor.storePartner.create({
    data: {
      storeId: params.storeId,
      status: 'approved',
      ...payload,
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
      reviewedAt: params.approvedAt,
      joinedAt: params.approvedAt,
    },
  });
}

export function toPartnerSnapshotPayload(
  application: Pick<
    StorePartnerApplicationRecord,
    | 'name'
    | 'phone'
    | 'idCard'
    | 'region'
    | 'intention'
    | 'applyReason'
    | 'paymentAccountType'
    | 'paymentAccountNo'
    | 'paymentAccountName'
  >,
): PartnerSnapshotPayload {
  return {
    name: application.name,
    phone: application.phone,
    idCard: application.idCard,
    region: application.region,
    intention: application.intention,
    applyReason: application.applyReason,
    paymentAccountType: application.paymentAccountType,
    paymentAccountNo: application.paymentAccountNo,
    paymentAccountName: application.paymentAccountName,
  };
}
