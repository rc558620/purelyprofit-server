import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PulseMembershipAdjustmentInput } from './membership.types';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';

@Injectable()
export class PulseMembershipAdminPointsMutationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
  ) {}

  async adjustAdminMemberPoints(
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<void> {
    const delta = this.resolveAdjustmentDelta(dto, '积分');
    const current =
      await this.mutationStateService.loadAdminMemberStateOrThrow(memberId);
    const nextAvailablePoints = current.profile.availablePoints + delta;
    const nextTotalPoints =
      current.profile.totalPoints + (delta > 0 ? delta : 0);

    if (nextAvailablePoints < 0) {
      throw new BadRequestException('当前积分不足，无法扣减');
    }

    await this.prisma.$transaction(async (tx) => {
      const profile = await tx.storeMembershipProfile.upsert({
        where: { storeId: memberId },
        create: {
          storeId: memberId,
          currentPlanId: null,
          startsAt: null,
          expiresAt: null,
          totalPoints: nextTotalPoints,
          availablePoints: nextAvailablePoints,
        },
        update: {
          totalPoints: nextTotalPoints,
          availablePoints: nextAvailablePoints,
        },
        select: { id: true },
      });

      await tx.storeMembershipPointsLog.create({
        data: {
          storeId: memberId,
          profileId: profile.id,
          source: 'admin_adjust',
          changeType: delta >= 0 ? 'increase' : 'decrease',
          changeAmount: Math.abs(delta),
          description: dto.reason.trim(),
        },
      });
    });

    await this.mutationStateService.invalidateAdminMemberDerived(memberId);
  }

  private resolveAdjustmentDelta(
    input: PulseMembershipAdjustmentInput,
    assetLabel: string,
  ): number {
    if (typeof input.delta === 'number' && input.delta !== 0) {
      return input.delta;
    }

    if (typeof input.amount !== 'number' || input.amount === 0) {
      throw new BadRequestException(`缺少${assetLabel}调整值`);
    }

    switch (input.direction) {
      case 'add':
        return Math.abs(input.amount);
      case 'subtract':
      case 'deduct':
      case 'reduce':
        return -Math.abs(input.amount);
      default:
        return input.amount;
    }
  }
}
