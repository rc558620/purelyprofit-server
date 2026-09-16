import { BadRequestException, Injectable } from '@nestjs/common';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { resolveStoredMembershipLevel } from '../../purely-profit/member/platform-membership/platform-membership-access.shared';
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

  /**
   * 解析降级到免费时需要转存的「原档位」`previousPlanId`。
   *
   * 设为免费会清空 `currentPlanId`，续费页由此无法判断「原本买的是哪一档」
   * （`resolveStoredMembershipLevel` 回落成 'free'），曾开通子账号功能的门店
   * 会被错判成年度档、丢掉 AGES(永久) 的续费入口，所以降级时必须先把原档位转存下来。
   *
   * 重新设置付费档位时返回 `null`：此时 `currentPlanId` 本身就是续费依据。
   *
   * 取 `resolveStoredMembershipLevel` 的结果（忽略到期判定），因此
   * 「已到期的年度会员」降级后原档位仍是年度，与续费保护的既有口径一致；
   * 历史永久会员（`yearly` + 无到期时间）也会被正确识别成 lifetime。
   */
  resolveNextPreviousPlanId(params: {
    profile: PulseAdminMembershipProfileRecord;
    nextPlanId: PulseAdminMembershipProfileRecord['currentPlanId'];
  }): PulseAdminMembershipProfileRecord['currentPlanId'] {
    if (params.nextPlanId !== null) {
      return null;
    }

    const storedLevel = resolveStoredMembershipLevel({
      currentPlanId: params.profile.currentPlanId,
      previousPlanId: params.profile.previousPlanId ?? null,
      startsAt: params.profile.startsAt ?? null,
      expiresAt: params.profile.expiresAt,
    });

    return storedLevel === 'free' ? null : storedLevel;
  }
}
