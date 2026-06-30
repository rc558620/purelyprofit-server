import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PulseMembershipAdjustmentInput } from './membership.types';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';

@Injectable()
export class PulseMembershipAdminBeansMutationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
  ) {}

  async adjustAdminMemberBeans(
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<void> {
    const delta = this.resolveAdjustmentDelta(dto, '纯利豆');
    const current =
      await this.mutationStateService.loadAdminMemberStateOrThrow(memberId);
    const nextBeanBalance = current.partner.beanBalance + delta;

    if (nextBeanBalance < 0) {
      throw new BadRequestException('当前纯利豆不足，无法扣减');
    }

    await this.prisma.$transaction(async (tx) => {
      const totalEarnedBeans = Math.max(
        current.partner.totalEarnedBeans + (delta > 0 ? delta : 0),
        0,
      );
      const now = new Date();
      const existingPartner = await tx.storePartner.findFirst({
        where: { storeId: memberId, deletedAt: null, status: 'approved' },
        select: { id: true, status: true },
        orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
      });
      const partner = existingPartner
        ? await tx.storePartner.update({
            where: { id: existingPartner.id },
            data: {
              status: 'approved',
              reviewedAt:
                existingPartner.status === 'approved' ? undefined : now,
              joinedAt: existingPartner.status === 'approved' ? undefined : now,
              beanBalance: nextBeanBalance,
              totalEarnedBeans,
            },
            select: { id: true },
          })
        : await tx.storePartner.create({
            data: {
              storeId: memberId,
              status: 'approved',
              reviewedAt: now,
              joinedAt: now,
              beanBalance: nextBeanBalance,
              totalEarnedBeans,
              totalWithdrawnBeans: current.partner.totalWithdrawnBeans,
            },
            select: { id: true },
          });

      await tx.storePartnerBeanLog.create({
        data: {
          storeId: memberId,
          partnerId: partner.id,
          source: 'admin_adjust',
          changeAmount: delta,
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
