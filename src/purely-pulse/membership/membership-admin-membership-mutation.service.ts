import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { resolveStoredMembershipLevel } from '../../purely-profit/member/platform-membership/platform-membership-access.shared';
import { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import { DAY_MS } from './membership.constants';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseAdminMembershipProfileRecord,
  PulseMembershipPlanId,
} from './membership.types';

@Injectable()
export class PulseMembershipAdminMembershipMutationService {
  private readonly logger = new Logger(
    PulseMembershipAdminMembershipMutationService.name,
  );

  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly prisma: PrismaService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
  ) {}

  /**
   * 落盘管理员设置的会员档位：解析目标档位 → 校验降级确认 → 写 profile
   * → 失效派生缓存 → 首次设置该档位时写入首购锁定价。
   *
   * 只负责「档案怎么写」，鉴权与详情重建由上层编排服务负责。
   */
  async applyAdminMembershipLevel(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminMembershipMutationInput,
  ): Promise<void> {
    const nextLevel = this.resolveAdminMemberLevel(dto);
    const current =
      await this.mutationStateService.loadAdminMemberStateOrThrow(memberId);
    this.assertFreeDowngradeConfirmed(current.profile, dto, nextLevel);
    const nextExpiry = await this.resolveAdminMembershipExpiry(dto, nextLevel);
    const nextPlanId = this.toMembershipPlanId(nextLevel);
    const nextPreviousPlanId = this.resolveNextPreviousPlanId({
      profile: current.profile,
      nextPlanId,
    });
    const now = new Date();

    this.logMembershipLevelMutation({
      user,
      memberId,
      previousPlanId: current.profile.currentPlanId,
      previousExpiresAt: current.profile.expiresAt,
      nextLevel,
      nextPlanId,
      nextExpiry,
      dto,
    });

    await this.prisma.storeMembershipProfile.upsert({
      where: { storeId: memberId },
      create: {
        storeId: memberId,
        currentPlanId: nextPlanId,
        // 降级为免费时转存原档位：currentPlanId 被清空后，续费页只能靠它
        // 判断「原本买的是哪一档」，否则永久会员会丢掉 AGES 续费入口
        previousPlanId: nextPreviousPlanId,
        // startsAt 始终落盘：即使降级为免费也保留，表示档案已被显式管理，
        // 避免 /center 的订单重建逻辑（normalizeMembershipProfileFromPaidOrders）
        // 把「管理员设置的免费」误判为「档案缺失」而用历史付费订单恢复会员
        startsAt: now,
        expiresAt: nextExpiry,
        totalPoints: current.profile.totalPoints,
        availablePoints: current.profile.availablePoints,
      },
      update: {
        currentPlanId: nextPlanId,
        previousPlanId: nextPreviousPlanId,
        startsAt: now,
        expiresAt: nextExpiry,
      },
    });

    await this.mutationStateService.invalidateAdminMemberDerived(memberId);

    // 首次设置该档位时把成交价写入「首购锁定价」；已存在则不覆盖（锁定语义）
    await this.lockFirstDealPrice({
      storeId: memberId,
      nextPlanId: nextLevel,
      priceDisplay: dto.priceDisplay,
    });
  }

  /** 重置门店的首购锁定价，让运营可以在下一次成交时重新锁价。返回清除条数。 */
  async resetAdminMemberLockedPrices(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<number> {
    const clearedCount =
      await this.lockedPriceService.resetLockedPrices(memberId);
    this.logger.warn(
      JSON.stringify({
        event: 'pulse_admin_membership_locked_price_reset',
        memberId,
        operatorUserId: user.id,
        operatorEmail: user.email,
        clearedCount,
      }),
    );

    await this.mutationStateService.invalidateAdminMemberDerived(memberId);

    return clearedCount;
  }

  private logMembershipLevelMutation(params: {
    user: AuthenticatedUser;
    memberId: number;
    previousPlanId: PulseMembershipPlanId | null;
    previousExpiresAt: Date | null;
    nextLevel: PulseAdminMemberLevel;
    nextPlanId: PulseMembershipPlanId | null;
    nextExpiry: Date | null;
    dto: PulseAdminMembershipMutationInput;
  }): void {
    const {
      user,
      memberId,
      previousPlanId,
      previousExpiresAt,
      nextLevel,
      nextPlanId,
      nextExpiry,
      dto,
    } = params;

    this.logger.warn(
      JSON.stringify({
        event: 'pulse_admin_membership_level_mutation',
        memberId,
        operatorUserId: user.id,
        operatorEmail: user.email,
        previousPlanId,
        previousExpiresAt: previousExpiresAt?.toISOString() ?? null,
        nextLevel,
        nextPlanId,
        nextExpiry: nextExpiry?.toISOString() ?? null,
        confirmDowngradeToFree: dto.confirmDowngradeToFree ?? false,
        actionSource: dto.actionSource ?? 'unknown',
        requestId: dto.auditContext?.requestId ?? null,
        ip: dto.auditContext?.ip ?? null,
        userAgent: dto.auditContext?.userAgent ?? null,
      }),
    );
  }

  /** 首次成交价快照：仅在带成交价且档位可购买时写入，已存在不覆盖 */
  private async lockFirstDealPrice(params: {
    storeId: number;
    nextPlanId: PulseAdminMemberLevel | null;
    priceDisplay?: string;
  }): Promise<void> {
    const { storeId, nextPlanId, priceDisplay } = params;
    const planId = nextPlanId ? this.toMembershipPlanId(nextPlanId) : null;
    const price = this.resolvePriceFen(priceDisplay);

    if (!planId || price === null) {
      return;
    }

    await this.lockedPriceService.lockPriceOnFirstDeal({
      storeId,
      planId,
      price,
      source: 'admin',
    });
  }

  /** 元字符串成交价 → 分；缺失或非法时返回 null（不写入锁定价） */
  private resolvePriceFen(priceDisplay?: string): number | null {
    if (typeof priceDisplay !== 'string') {
      return null;
    }

    const parsedValue = Number.parseFloat(priceDisplay.trim());
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return null;
    }

    return Math.round(parsedValue * 100);
  }

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
