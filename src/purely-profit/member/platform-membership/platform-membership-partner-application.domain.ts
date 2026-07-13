import type {
  PartnerSnapshotPayload,
  PrismaExecutor,
  StorePartnerApplicationRecord,
  StorePartnerRecord,
} from './platform-membership.types';
import { findStorePartnerByApplicant } from './platform-membership.query';

/**
 * 归一化手机号：仅保留数字，去除空格、分隔符与区号前缀等，
 * 用于同人判定时忽略 "138-0013-8000" 与 "13800138000" 这类格式差异（见 B9）。
 */
export function normalizePartnerPhone(
  phone: string | null | undefined,
): string {
  if (!phone) {
    return '';
  }
  return phone.replace(/\D/g, '');
}

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

export interface ApplicantIdentifier {
  idCard?: string | null;
  phone?: string | null;
}

/**
 * 统一的“同人”判定：双方都有身份证时仅以身份证为准；
 * 任一方无身份证时回退到归一化手机号。
 * 所有合伙人匹配/拦截逻辑都应收口于此，避免展示与拦截使用不同语义，
 * 导致“拦 vs 不拦”或“展示 vs 不展示”错位
 * （见 member-partners 缺陷排查：原 matchPartner 用 OR 逻辑与 isSameApplicant 不一致）。
 */
export function isSameApplicantIdentifier(
  a: ApplicantIdentifier,
  b: ApplicantIdentifier,
): boolean {
  const idCardA = a.idCard?.trim().toUpperCase();
  const idCardB = b.idCard?.trim().toUpperCase();

  // 双方都有身份证时，仅以身份证为准
  if (idCardA && idCardB) {
    return idCardA === idCardB;
  }

  // 任一方无身份证时，回退到手机号（按数字归一化，忽略格式差异）
  const phoneA = normalizePartnerPhone(a.phone);
  const phoneB = normalizePartnerPhone(b.phone);

  if (phoneA && phoneB) {
    return phoneA === phoneB;
  }

  return false;
}

/**
 * 同人去重 key：与 isSameApplicantIdentifier 保持一致——
 * 优先以身份证归一化值，无身份证时以归一化手机号，避免换号申请人无法去重
 * （见 member-partners 缺陷排查：原去重 key 为 idCard|phone 组合，换号时不生效）。
 */
export function applicantIdentityKey(applicant: ApplicantIdentifier): string {
  const idCard = applicant.idCard?.trim().toUpperCase();
  if (idCard) {
    return `idCard:${idCard}`;
  }
  const phone = normalizePartnerPhone(applicant.phone);
  if (phone) {
    return `phone:${phone}`;
  }
  return 'unknown';
}

export function isSameApplicant(
  applicant:
    | Pick<StorePartnerApplicationRecord, 'idCard' | 'phone'>
    | Pick<StorePartnerRecord, 'idCard' | 'phone'>,
  payload: Pick<PartnerSnapshotPayload, 'idCard' | 'phone'>,
): boolean {
  return isSameApplicantIdentifier(applicant, payload);
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
