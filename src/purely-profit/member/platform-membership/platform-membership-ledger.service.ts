import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipPointsLogsResponseDto,
} from './dto/platform-membership-response.dto';
import { normalizeMembershipProfileFromPaidOrders } from './membership-plan-resolver';
import {
  buildApprovedPartnerResponse,
  buildApprovedPartnersResponse,
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
  findPaidStoreMembershipOrders,
  findStorePartners,
  loadPlanCatalog,
} from './platform-membership.query';

@Injectable()
export class PlatformMembershipLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async listPointsLogsByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    const [profile, logs, paidOrders, plans] = await Promise.all([
      ensureMembershipProfile(this.prisma, storeId),
      this.prisma.storeMembershipPointsLog.findMany({
        where: { storeId },
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
      findPaidStoreMembershipOrders(this.prisma, storeId),
      loadPlanCatalog(this.prisma),
    ]);
    const effectiveProfile = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders,
      plans,
    });
    const memberInfo = buildMembershipInfo(effectiveProfile);

    return {
      memberInfo,
      overview: buildPointsOverview(memberInfo.availablePoints, logs),
      items: logs.map((log) => mapPointsLog(log)),
    };
  }

  async listBeanLogsByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    const partners = await findStorePartners(this.prisma, storeId);
    const logs =
      partners.length > 0
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
    const primaryPartner = partners[0] ?? null;

    return {
      approvedPartner: buildApprovedPartnerResponse(primaryPartner),
      approvedPartners: buildApprovedPartnersResponse(partners),
      overview: buildBeanOverview(partners),
      items: logs.map((log) => mapBeanLog(log)),
    };
  }
}
