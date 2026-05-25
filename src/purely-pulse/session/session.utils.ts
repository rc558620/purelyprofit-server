import { toOptionalMediaText } from '../../purely-profit/commerce/commerce.utils';
import type { PulseTargetStoreSummary } from '../pulse-store-context.types';
import type {
  PulseSessionMembershipDto,
  PulseSessionStoreDto,
  PulseSessionUserDto,
} from './dto/session-bootstrap.dto';
import type { MembershipProfileRow, UserProfileRow } from './session.types';

const DAY_MS = 86_400_000;

export function buildUserDto(
  user: UserProfileRow,
  phone: string,
): PulseSessionUserDto {
  return {
    id: user.id,
    phone,
    name: user.name,
    avatar: toOptionalMediaText(user.avatar) ?? '',
    verified: Boolean(user.realName && user.idNumber),
  };
}

export function buildStoreDto(
  store: PulseTargetStoreSummary,
): PulseSessionStoreDto {
  return {
    id: store.id,
    name: store.name,
    address: store.address,
  };
}

export function buildMembershipDto(
  profile: MembershipProfileRow | null,
): PulseSessionMembershipDto {
  if (!profile || !profile.currentPlanId) {
    return {
      isActive: false,
      planId: null,
      planName: null,
      remainingDays: 0,
      expiresAt: null,
    };
  }

  const expiresAt = profile.expiresAt;
  const isActive = expiresAt ? expiresAt > new Date() : false;

  return {
    isActive,
    planId: profile.currentPlanId,
    planName: profile.planName,
    remainingDays: calcRemainingDays(expiresAt),
    expiresAt,
  };
}

function calcRemainingDays(expiresAt: Date | null): number {
  if (!expiresAt) {
    return 0;
  }

  const diffMs = expiresAt.getTime() - Date.now();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / DAY_MS);
}
