import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminMemberReadService } from './membership-admin-member-read.service';
import type {
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
} from './membership.types';

@Injectable()
export class PulseMembershipAdminMutationStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly memberReadService: PulseMembershipAdminMemberReadService,
  ) {}

  async assertAdminMemberMutationAccess(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<void> {
    await this.accessService.assertAdminMemberMutationAccess(user, memberId);
  }

  invalidatePulseDashboardHome(): Promise<void> {
    return this.cacheInvalidatorService.invalidatePulseDashboardHome();
  }

  async invalidateAdminMemberDerived(memberId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidatePulseDashboardHome(),
      this.cacheInvalidatorService.invalidatePulseDashboardOverview(memberId),
      this.cacheInvalidatorService.invalidatePulseSessionNotification(memberId),
      this.cacheInvalidatorService.invalidatePulseSessionBootstrap(memberId),
      this.accessService.kickAllStoreUsers(memberId),
    ]);
  }

  async loadAdminMemberStateOrThrow(storeId: number): Promise<{
    profile: PulseAdminMembershipProfileRecord;
    partner: PulseAdminPartnerRecord;
  }> {
    const [store, profile, partner] = await Promise.all([
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true },
      }),
      this.memberReadService.findMembershipProfileByStoreId(storeId),
      this.prisma.storePartner.findFirst({
        where: { storeId, status: 'approved' },
        select: {
          id: true,
          status: true,
          beanBalance: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
        orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    if (!store) {
      throw new NotFoundException('会员不存在');
    }

    return {
      profile: profile ?? {
        currentPlanId: null,
        expiresAt: null,
        totalPoints: 0,
        availablePoints: 0,
        subAccountQuota: 0,
      },
      partner: partner ?? {
        id: 0,
        status: 'approved',
        beanBalance: 0,
        totalEarnedBeans: 0,
        totalWithdrawnBeans: 0,
      },
    };
  }
}
