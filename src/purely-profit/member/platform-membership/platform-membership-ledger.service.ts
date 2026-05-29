import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipPointsLogsResponseDto,
} from './dto/platform-membership-response.dto';
import {
  buildApprovedPartnerResponse,
  buildApprovedPartnersResponse,
  buildBeanOverview,
  buildMembershipInfo,
  buildPointsOverview,
  mapBeanLog,
  mapPointsLog,
} from './platform-membership.domain';
import {
  ensureMembershipProfile,
  findStorePartners,
} from './platform-membership.query';

@Injectable()
export class PlatformMembershipLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async listPointsLogsByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    const profile = await ensureMembershipProfile(this.prisma, storeId);
    const logs = await this.prisma.storeMembershipPointsLog.findMany({
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
    });

    const memberInfo = buildMembershipInfo(profile);

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
