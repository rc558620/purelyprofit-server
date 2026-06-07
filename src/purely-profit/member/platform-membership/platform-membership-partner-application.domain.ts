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
  partners: StorePartnerRecord[],
  payload: PartnerSnapshotPayload,
): boolean {
  return partners.some((partner) => isSameApplicant(partner, payload));
}

export function isSameApplicant(
  applicant:
    | Pick<StorePartnerApplicationRecord, 'idCard' | 'phone'>
    | Pick<StorePartnerRecord, 'idCard' | 'phone'>,
  payload: Pick<PartnerSnapshotPayload, 'idCard' | 'phone'>,
): boolean {
  const normalizedIdCard = applicant.idCard?.trim().toUpperCase();

  if (normalizedIdCard) {
    return normalizedIdCard === payload.idCard;
  }

  return applicant.phone?.trim() === payload.phone;
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
