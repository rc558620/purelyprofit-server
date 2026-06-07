import { BadRequestException, Injectable } from '@nestjs/common';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { DAY_MS } from './membership.constants';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseAdminMembershipProfileRecord,
} from './membership.types';

@Injectable()
export class PulseMembershipAdminMembershipMutationService {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
  ) {}

  resolveAdminMemberLevel(
    dto: PulseAdminMembershipMutationInput,
  ): PulseAdminMemberLevel {
    const nextLevel = dto.level ?? dto.memberLevel ?? dto.membershipLevel;
    if (!nextLevel) {
      throw new BadRequestException('缺少会员等级');
    }

    return nextLevel;
  }

  assertFreeDowngradeConfirmed(
    profile: PulseAdminMembershipProfileRecord,
    dto: PulseAdminMembershipMutationInput,
    nextLevel: PulseAdminMemberLevel,
  ): void {
    if (nextLevel !== 'free') {
      return;
    }

    const isCurrentlyActive =
      profile.currentPlanId !== null &&
      profile.expiresAt !== null &&
      profile.expiresAt.getTime() > Date.now();

    if (!isCurrentlyActive) {
      return;
    }

    if (dto.confirmDowngradeToFree === true) {
      return;
    }

    throw new BadRequestException(
      '当前会员仍在有效期内，降级到免费会员需要显式确认',
    );
  }

  async resolveAdminMembershipExpiry(
    dto: PulseAdminMembershipMutationInput,
    nextLevel: PulseAdminMemberLevel,
  ): Promise<Date | null> {
    const rawExpiry = dto.membershipExpiry ?? dto.expireAt ?? dto.expiryAt;
    if (rawExpiry !== null && rawExpiry !== undefined) {
      const explicitExpiry = new Date(rawExpiry);
      if (Number.isNaN(explicitExpiry.getTime())) {
        throw new BadRequestException('会员到期时间不合法');
      }
      return explicitExpiry;
    }

    if (nextLevel === 'free') {
      return null;
    }

    if (nextLevel === 'lifetime') {
      const lifetimePlan =
        await this.platformMembershipService.getPlanConfig('lifetime');
      if (lifetimePlan.validDays !== null && lifetimePlan.validDays > 0) {
        return new Date(Date.now() + lifetimePlan.validDays * DAY_MS);
      }
      return null;
    }

    throw new BadRequestException('缺少会员到期时间');
  }

  toMembershipPlanId(
    level: PulseAdminMemberLevel,
  ): PulseAdminMembershipProfileRecord['currentPlanId'] {
    switch (level) {
      case 'monthly':
        return 'monthly';
      case 'quarterly':
        return 'quarterly';
      case 'annual':
        return 'yearly';
      case 'lifetime':
        return 'lifetime';
      default:
        return null;
    }
  }
}
