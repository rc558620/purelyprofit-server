import { Injectable } from '@nestjs/common';
import { PartnerWithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipPointsLogsResponseDto,
} from './dto/platform-membership-response.dto';
import { normalizeMembershipProfileFromPaidOrders } from './membership-plan-resolver';
import {
  buildApprovedPartnerResponse,
  buildMembershipInfo,
} from './membership-profile.mapper';
import {
  buildBeanOverview,
  buildPointsOverview,
  mapBeanLog,
  mapPointsLog,
} from './platform-membership-ledger.domain';
import {
  ensureMembershipProfile,
  findCurrentStorePartner,
  findPaidStoreMembershipOrders,
  loadDbNowMs,
  loadPlanCatalog,
} from './platform-membership.query';

@Injectable()
export class PlatformMembershipLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async listPointsLogsByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    const [profile, logs, paidOrders, plans, inviteCodeRecord, dbNowMs] =
      await Promise.all([
        ensureMembershipProfile(this.prisma, storeId),
        this.prisma.storeMembershipPointsLog.findMany({
          where: { storeId },
          select: {
            id: true,
            source: true,
            changeType: true,
            changeAmount: true,
            description: true,
            expireAt: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        findPaidStoreMembershipOrders(this.prisma, storeId),
        loadPlanCatalog(this.prisma),
        this.prisma.storeInviteCode.findFirst({
          where: { storeId, isActive: true },
          select: { code: true },
          orderBy: { createdAt: 'desc' },
        }),
        loadDbNowMs(this.prisma),
      ]);
    const effectiveProfile = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders,
      plans,
      nowMs: dbNowMs ?? Date.now(),
    });
    const memberInfo = buildMembershipInfo(
      effectiveProfile,
      inviteCodeRecord?.code ?? null,
    );

    return {
      memberInfo,
      overview: buildPointsOverview(memberInfo.availablePoints, logs),
      items: logs.map((log) => mapPointsLog(log)),
    };
  }

  async listBeanLogsByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    // 与 withdrawals/overview 保持同一口径：待结算豆 = 处理中(pending + approved)
    // 提现记录的 beanAmount 之和，而不是依赖恒定不变的「总获得 - 总提现 - 余额」。
    const [partner, pendingAgg] = await Promise.all([
      findCurrentStorePartner(this.prisma, storeId),
      this.prisma.partnerWithdrawal.aggregate({
        where: {
          storeId,
          status: {
            in: [
              PartnerWithdrawalStatus.pending,
              PartnerWithdrawalStatus.approved,
            ],
          },
        },
        _sum: { beanAmount: true },
      }),
    ]);
    const logs = partner
      ? await this.prisma.storePartnerBeanLog.findMany({
          where: { storeId },
          select: {
            id: true,
            source: true,
            changeAmount: true,
            description: true,
            relatedPromoRecordId: true,
            relatedUser: true,
            relatedPlanType: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
      : [];

    return {
      approvedPartner: buildApprovedPartnerResponse(partner),
      approvedPartners: partner ? [buildApprovedPartnerResponse(partner)!] : [],
      overview: buildBeanOverview(partner, pendingAgg._sum.beanAmount ?? 0),
      items: logs.map((log) => mapBeanLog(log)),
    };
  }
}
