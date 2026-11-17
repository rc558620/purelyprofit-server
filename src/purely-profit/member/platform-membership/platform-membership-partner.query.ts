// 平台会员 · 合伙人读查询（当前合伙人 / 按申请人反查），select 与排序口径集中在此
import type {
  PartnerSnapshotPayload,
  PrismaExecutor,
  StorePartnerRecord,
} from './platform-membership.types';

const storePartnerSelect = {
  id: true,
  status: true,
  name: true,
  phone: true,
  idCard: true,
  region: true,
  intention: true,
  applyReason: true,
  paymentAccountType: true,
  paymentAccountNo: true,
  paymentAccountName: true,
  beanBalance: true,
  totalEarnedBeans: true,
  totalWithdrawnBeans: true,
  joinedAt: true,
  reviewedAt: true,
  createdAt: true,
  store: {
    select: {
      owner: {
        select: {
          avatar: true,
        },
      },
    },
  },
} as const;

/** 获取当前账号的唯一合伙人（单合伙人逻辑） */
export async function findCurrentStorePartner(
  prismaExecutor: PrismaExecutor,
  storeId: number,
): Promise<StorePartnerRecord | null> {
  return prismaExecutor.storePartner.findFirst({
    where: { storeId, deletedAt: null, status: 'approved' },
    select: storePartnerSelect,
    orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
  });
}

export async function findStorePartnerByApplicant(
  prismaExecutor: PrismaExecutor,
  storeId: number,
  applicant: Pick<PartnerSnapshotPayload, 'idCard' | 'phone'>,
): Promise<StorePartnerRecord | null> {
  const baseWhere = { storeId, deletedAt: null };
  const orderOpts = [
    { status: 'desc' as const },
    { reviewedAt: 'desc' as const },
    { joinedAt: 'desc' as const },
    { id: 'desc' as const },
  ];

  // 有身份证时优先以身份证匹配
  if (applicant.idCard) {
    const byIdCard = await prismaExecutor.storePartner.findFirst({
      where: { ...baseWhere, idCard: applicant.idCard },
      select: storePartnerSelect,
      orderBy: orderOpts,
    });
    if (byIdCard) return byIdCard;
  }

  // 无身份证或未命中时回退到手机号
  if (applicant.phone) {
    return prismaExecutor.storePartner.findFirst({
      where: { ...baseWhere, phone: applicant.phone },
      select: storePartnerSelect,
      orderBy: orderOpts,
    });
  }

  return null;
}
