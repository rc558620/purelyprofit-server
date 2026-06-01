import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import { PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT } from './dto/pulse-membership-admin-logs.shared.dto';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.request.dto';
import type { PulseMemberListItemDto } from './dto/pulse-membership-admin-members.response.dto';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipProfileRecord,
  PulseAdminStoreIdentityRecord,
} from './membership.types';

export type LegacyPulseAdminMembershipProfileRecord = Omit<
  PulseAdminMembershipProfileRecord,
  'subAccountQuota'
>;

export type PulseAdminMembershipProfileListRecord =
  PulseAdminMembershipProfileRecord & { storeId: number };

type AdminMemberLogsCursor = {
  createdAt: Date;
  id: number;
};

type AdminMemberLogsCursorPagination = {
  cursor?: AdminMemberLogsCursor;
  limit?: number;
};

export function resolveAdminMemberLogsCursorPagination(
  query: GetPulseAdminMemberLogsQueryDto,
): AdminMemberLogsCursorPagination {
  if (query.cursor === undefined && query.limit === undefined) {
    return {};
  }

  if (query.cursor === undefined) {
    return {
      limit: query.limit ?? PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT,
    };
  }

  const cursor = parseAdminMemberLogsCursor(query.cursor);
  if (!cursor) {
    throw new ConflictException('cursor 格式不合法');
  }

  return {
    cursor,
    limit: query.limit ?? PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT,
  };
}

export function encodeAdminMemberLogsCursor(
  log: Pick<AdminMemberLogsCursor, 'createdAt' | 'id'> | null,
): string | null {
  if (!log) {
    return null;
  }

  return `${log.createdAt.getTime()}_${log.id}`;
}

export function isMissingSubAccountQuotaSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (
    !message.includes('sub_account_quota') &&
    !message.includes('subaccountquota')
  ) {
    return false;
  }

  return (
    message.includes('does not exist') ||
    message.includes("doesn't exist") ||
    message.includes('unknown column') ||
    message.includes('no such column') ||
    message.includes('unknown field') ||
    message.includes('column')
  );
}

export function buildAdminMemberListStoreWhere(
  storeIds: number[],
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput {
  const filters: Prisma.StoreWhereInput[] = [{ id: { in: storeIds } }];

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

  const keywordWhere = buildAdminMemberKeywordStoreWhere(query);
  if (keywordWhere) {
    filters.push(keywordWhere);
  }

  return filters.length === 1 ? filters[0] : { AND: filters };
}

export function matchesAdminMemberFilters(
  member: Pick<
    PulseMemberListItemDto,
    'name' | 'phone' | 'status' | 'level' | 'isPartner'
  >,
  query: GetPulseAdminMembersQueryDto,
): boolean {
  if (
    query.status &&
    query.status !== 'all' &&
    member.status !== query.status
  ) {
    return false;
  }

  if (query.level && query.level !== 'all' && member.level !== query.level) {
    return false;
  }

  if (query.partner === true && !member.isPartner) {
    return false;
  }

  const keyword = query.keyword?.trim().toLowerCase();
  if (!keyword) {
    return true;
  }

  return (
    member.name.toLowerCase().includes(keyword) ||
    member.phone.toLowerCase().includes(keyword)
  );
}

export function resolveAdminMemberDisplayName(
  store: Pick<PulseAdminStoreIdentityRecord, 'name' | 'owner'>,
): string {
  return store.owner.realName ?? store.owner.name ?? store.name;
}

export function resolveAdminMemberPhone(
  store: Pick<PulseAdminStoreIdentityRecord, 'contactPhone' | 'owner'>,
): string {
  const contactPhone = store.contactPhone?.trim();
  if (contactPhone) {
    return contactPhone;
  }

  const ownerEmail = store.owner.email.trim().toLowerCase();
  const matchedPhone = /^phone_(\d{11})@purelyprofit\.local$/.exec(ownerEmail);
  return matchedPhone?.[1] ?? '';
}

export function maskAdminMemberPhone(phone: string): string {
  const normalizedPhone = phone.replace(/\s+/g, '');
  if (!/^1\d{10}$/.test(normalizedPhone)) {
    return normalizedPhone || '--';
  }

  return `${normalizedPhone.slice(0, 3)}****${normalizedPhone.slice(-4)}`;
}

export function toPulseMemberLevel(
  planId: PulseAdminMembershipProfileRecord['currentPlanId'],
  expiresAt: Date | null,
): PulseAdminMemberLevel {
  if (planId === 'yearly' && expiresAt === null) {
    return 'lifetime';
  }

  switch (planId) {
    case 'monthly':
      return 'monthly';
    case 'quarterly':
      return 'quarterly';
    case 'yearly':
      return 'annual';
    case 'lifetime':
      return 'lifetime';
    default:
      return 'free';
  }
}

function parseAdminMemberLogsCursor(
  cursor: string,
): AdminMemberLogsCursor | null {
  const match = /^(\d+)_(\d+)$/.exec(cursor);
  if (!match) {
    return null;
  }

  const [, rawCreatedAt, rawId] = match;
  const createdAtMs = Number(rawCreatedAt);
  const id = Number(rawId);
  if (
    !Number.isSafeInteger(createdAtMs) ||
    !Number.isSafeInteger(id) ||
    createdAtMs <= 0 ||
    id <= 0
  ) {
    return null;
  }

  return {
    createdAt: new Date(createdAtMs),
    id,
  };
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
