import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipPointsLogsResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { PulseMembershipAccessService } from './membership-access.service';
import type {
  PulseDeveloperBeanLogRecord,
  PulseDeveloperBeanPartnerRecord,
  PulseDeveloperPointsLogRecord,
  PulseDeveloperPointsProfileRecord,
} from './membership.types';

@Injectable()
export class PulseMembershipLedgerService {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly prisma: PrismaService,
    private readonly pulseStoreContextService: PulseStoreContextService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

  async listPointsLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    const resolvedStore = await this.pulseStoreContextService.resolveTargetStore(user);
    if (resolvedStore.store) {
      return this.platformMembershipService.listPointsLogsByStoreId(
        resolvedStore.store.id,
      );
    }

    if (this.accessService.isDeveloper(user)) {
      return this.listDeveloperPointsLogs();
    }

    throw new NotFoundException('当前未选中目标商家门店，暂无法查看积分明细');
  }

  async listBeanLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    const resolvedStore = await this.pulseStoreContextService.resolveTargetStore(user);
    if (resolvedStore.store) {
      return this.platformMembershipService.listBeanLogsByStoreId(
        resolvedStore.store.id,
      );
    }

    if (this.accessService.isDeveloper(user)) {
      return this.listDeveloperBeanLogs();
    }

    throw new NotFoundException('当前未选中目标商家门店，暂无法查看纯利豆明细');
  }

  private async listDeveloperPointsLogs(): Promise<PlatformMembershipPointsLogsResponseDto> {
    const [profiles, logs]: [
      PulseDeveloperPointsProfileRecord[],
      PulseDeveloperPointsLogRecord[],
    ] = await Promise.all([
      this.prisma.storeMembershipProfile.findMany({
        where: {
          store: this.accessService.buildAdminStoreExclusionWhere(),
        },
        select: {
          storeId: true,
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      }),
      this.prisma.storeMembershipPointsLog.findMany({
        where: {
          store: this.accessService.buildAdminStoreExclusionWhere(),
        },
        select: {
          id: true,
          source: true,
          changeAmount: true,
          description: true,
          expireAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const totalPoints = profiles.reduce(
      (sum, profile) => sum + profile.totalPoints,
      0,
    );
    const availablePoints = profiles.reduce(
      (sum, profile) => sum + profile.availablePoints,
      0,
    );
    const now = Date.now();
    const activeProfile = profiles.find((profile) => {
      const expiredAt = profile.expiresAt?.getTime() ?? null;
      return expiredAt !== null && expiredAt > now;
    });

    return {
      memberInfo: {
        isActive: activeProfile !== undefined,
        planId: null,
        expiredAt: null,
        inviteCode: 'PULSE',
        totalPoints,
        availablePoints,
      },
      overview: {
        availablePoints,
        totalEarned: logs.reduce(
          (sum, log) => (log.changeAmount > 0 ? sum + log.changeAmount : sum),
          0,
        ),
        totalSpent: logs.reduce(
          (sum, log) =>
            log.changeAmount < 0 ? sum + Math.abs(log.changeAmount) : sum,
          0,
        ),
      },
      items: logs.map((log) => this.mapDeveloperPointsLog(log)),
    };
  }

  private mapDeveloperPointsLog(
    log: PulseDeveloperPointsLogRecord,
  ): PlatformMembershipPointsLogsResponseDto['items'][number] {
    const type: PlatformMembershipPointsLogsResponseDto['items'][number]['type'] =
      log.source === 'expire'
        ? 'expire'
        : log.changeAmount > 0
          ? 'earn'
          : 'spend';

    return {
      id: `pts-${log.id}`,
      amount: log.changeAmount,
      type,
      source: log.source,
      description: log.description,
      createdAt: log.createdAt.getTime(),
      expireAt: log.expireAt ? log.expireAt.getTime() : undefined,
    };
  }

  private async listDeveloperBeanLogs(): Promise<PlatformMembershipBeanLogsResponseDto> {
    const [partners, logs]: [
      PulseDeveloperBeanPartnerRecord[],
      PulseDeveloperBeanLogRecord[],
    ] = await Promise.all([
      this.prisma.storePartner.findMany({
        where: {
          status: 'approved',
          store: this.accessService.buildAdminStoreExclusionWhere(),
        },
        select: {
          beanBalance: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
      }),
      this.prisma.storePartnerBeanLog.findMany({
        where: {
          store: this.accessService.buildAdminStoreExclusionWhere(),
        },
        select: {
          id: true,
          source: true,
          changeAmount: true,
          description: true,
          relatedPromoRecordId: true,
          relatedPlanType: true,
          relatedUser: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const overview = partners.reduce(
      (summary, partner) => ({
        beanBalance: summary.beanBalance + partner.beanBalance,
        totalEarnedBeans: summary.totalEarnedBeans + partner.totalEarnedBeans,
        totalWithdrawnBeans:
          summary.totalWithdrawnBeans + partner.totalWithdrawnBeans,
      }),
      {
        beanBalance: 0,
        totalEarnedBeans: 0,
        totalWithdrawnBeans: 0,
      },
    );

    return {
      approvedPartner: null,
      overview,
      items: logs.map((log) => this.mapDeveloperBeanLog(log)),
    };
  }

  private mapDeveloperBeanLog(
    log: PulseDeveloperBeanLogRecord,
  ): PlatformMembershipBeanLogsResponseDto['items'][number] {
    const type: PlatformMembershipBeanLogsResponseDto['items'][number]['type'] =
      log.source === 'withdrawal'
        ? 'withdraw'
        : log.changeAmount > 0
          ? 'earn'
          : 'spend';

    return {
      id: String(log.id),
      amount: log.changeAmount,
      type,
      source: log.source,
      description: log.description,
      relatedPromoId: log.relatedPromoRecordId
        ? String(log.relatedPromoRecordId)
        : undefined,
      relatedPlanType: log.relatedPlanType ?? undefined,
      relatedUser: log.relatedUser ?? undefined,
      createdAt: log.createdAt.getTime(),
    };
  }
}
