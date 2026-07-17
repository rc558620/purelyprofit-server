import type { Prisma } from '@prisma/client';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.request.dto';

export function buildAdminMemberListStoreWhere(
  storeIds: number[],
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput {
  // 始终过滤已注销（deletedAt 非 null）的门店，确保其不出现在会员列表中。
  const filters: Prisma.StoreWhereInput[] = [
    { id: { in: storeIds } },
    { deletedAt: null },
  ];

  if (query.partner === true) {
    filters.push({
      partners: {
        some: {
          status: 'approved',
        },
      },
    });
  }

  const levelWhere = buildAdminMemberLevelStoreWhere(query);
  if (levelWhere) {
    filters.push(levelWhere);
  }

  const statusWhere = buildAdminMemberStatusStoreWhere(query);
  if (statusWhere) {
    filters.push(statusWhere);
  }

  const expiryWhere = buildAdminMemberExpiryStoreWhere(query);
  if (expiryWhere) {
    filters.push(expiryWhere);
  }

  const keywordWhere = buildAdminMemberKeywordStoreWhere(query);
  if (keywordWhere) {
    filters.push(keywordWhere);
  }

  return filters.length === 1 ? filters[0] : { AND: filters };
}

function buildAdminMemberLevelStoreWhere(
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput | null {
  switch (query.level) {
    case 'free':
      return {
        OR: [
          { membershipProfile: { is: null } },
          { membershipProfile: { is: { currentPlanId: null } } },
        ],
      };
    case 'monthly':
      return {
        membershipProfile: { is: { currentPlanId: 'monthly' } },
      };
    case 'quarterly':
      return {
        membershipProfile: { is: { currentPlanId: 'quarterly' } },
      };
    case 'annual':
      return {
        membershipProfile: {
          is: {
            currentPlanId: 'yearly',
            expiresAt: { not: null },
          },
        },
      };
    case 'lifetime':
      return {
        OR: [
          { membershipProfile: { is: { currentPlanId: 'lifetime' } } },
          {
            membershipProfile: {
              is: {
                currentPlanId: 'yearly',
                expiresAt: null,
              },
            },
          },
        ],
      };
    default:
      return null;
  }
}

function buildAdminMemberStatusStoreWhere(
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput | null {
  const now = new Date();

  switch (query.status) {
    case 'active':
      return {
        membershipProfile: {
          is: {
            expiresAt: { gt: now },
          },
        },
      };
    case 'inactive':
      return {
        OR: [
          { membershipProfile: { is: null } },
          { membershipProfile: { is: { expiresAt: null } } },
          {
            membershipProfile: {
              is: {
                expiresAt: { lte: now },
              },
            },
          },
        ],
      };
    default:
      return null;
  }
}

function buildAdminMemberExpiryStoreWhere(
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput | null {
  if (!query.expiry || query.expiry === 'all') {
    return null;
  }

  const now = new Date();
  const dayMs = 86_400_000;
  let days = 0;

  switch (query.expiry) {
    case '1m':
      days = 30;
      break;
    case '3m':
      days = 90;
      break;
    case '6m':
      days = 180;
      break;
    case '1y':
      days = 365;
      break;
    case '2y':
      days = 730;
      break;
    default:
      return null;
  }

  const thresholdDate = new Date(now.getTime() + days * dayMs);

  return {
    membershipProfile: {
      is: {
        AND: [
          // 会员到期时间在当前时间和阈值时间之间
          { expiresAt: { gt: now } },
          { expiresAt: { lte: thresholdDate } },
          // 排除 free（无计划）和 lifetime 会员，其余计划类型均参与到期筛选
          { currentPlanId: { not: null } },
          { currentPlanId: { not: 'lifetime' } },
        ],
      },
    },
  };
}

function buildAdminMemberKeywordStoreWhere(
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput | null {
  const keyword = query.keyword?.trim();
  if (!keyword) {
    return null;
  }

  const normalizedPhoneKeyword = keyword.replace(/\s+/g, '');

  return {
    OR: [
      { name: { contains: keyword, mode: 'insensitive' } },
      { contactPhone: { contains: normalizedPhoneKeyword } },
      { owner: { name: { contains: keyword, mode: 'insensitive' } } },
      { owner: { realName: { contains: keyword, mode: 'insensitive' } } },
      {
        owner: {
          email: { contains: normalizedPhoneKeyword, mode: 'insensitive' },
        },
      },
    ],
  };
}
