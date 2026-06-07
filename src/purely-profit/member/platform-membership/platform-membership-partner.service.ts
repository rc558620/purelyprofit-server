import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/cache-invalidator.service';
import {
  ApplyPlatformPartnerDto,
  type CreatePlatformPartnerFollowUpNoteDto,
} from './dto/platform-membership-query.dto';
import type { PlatformMembershipPartnerProfileResponseDto } from './dto/platform-membership-response.dto';
import { buildPartnerApplicationPayload } from './platform-membership-partner.domain';
import {
  findBlockingApplication,
  hasApprovedPartnerForApplicant,
  upsertApprovedPartnerSnapshot,
} from './platform-membership-partner-application.domain';
import { buildPartnerProfileByStoreId } from './platform-membership-partner-profile.domain';
import {
  ensurePlatformMembershipStoreOwner,
  findStorePartnerApplications,
  findStorePartners,
  getScopedStorePartnerApplicationOrThrow,
} from './platform-membership.query';

@Injectable()
export class PlatformMembershipPartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async getPartnerProfileByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return buildPartnerProfileByStoreId(this.prisma, storeId);
  }

  async applyPartner(
    userId: number,
    storeId: number,
    dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    await ensurePlatformMembershipStoreOwner(this.prisma, userId, storeId);

    const [approvedPartners, applications] = await Promise.all([
      findStorePartners(this.prisma, storeId),
      findStorePartnerApplications(this.prisma, storeId),
    ]);
    const payload = buildPartnerApplicationPayload(dto);

    if (hasApprovedPartnerForApplicant(approvedPartners, payload)) {
      throw new ConflictException('该合伙人已通过审核，无需重复申请');
    }

    const blockingApplication = findBlockingApplication(applications, payload);

    if (blockingApplication?.status === 'approved') {
      throw new ConflictException('该合伙人已通过审核，无需重复申请');
    }

    if (
      blockingApplication?.status === 'pending' ||
      blockingApplication?.status === 'reviewing'
    ) {
      throw new ConflictException('该合伙人已有申请在审核中，请耐心等待');
    }

    const response = await this.prisma.$transaction(async (tx) => {
      await tx.storePartnerApplication.create({
        data: {
          storeId,
          status: 'pending',
          ...payload,
        },
      });

      return buildPartnerProfileByStoreId(tx, storeId);
    });

    await this.cacheInvalidatorService.invalidatePulseDashboardHome();

    return response;
  }

  async markPartnerApplicationReviewing(
    storeId: number,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const response = await this.prisma.$transaction(async (tx) => {
      const application = await getScopedStorePartnerApplicationOrThrow(
        tx,
        storeId,
        applicationId,
      );

      if (application.status !== 'pending') {
        throw new ConflictException('仅待审核申请可进入审核中');
      }

      const updateResult = await tx.storePartnerApplication.updateMany({
        where: {
          id: applicationId,
          storeId,
          status: 'pending',
        },
        data: {
          status: 'reviewing',
          reviewedAt: null,
          joinedAt: null,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('申请状态已变化，请刷新后重试');
      }

      return buildPartnerProfileByStoreId(tx, storeId);
    });

    await this.cacheInvalidatorService.invalidatePulseDashboardHome();

    return response;
  }

  async approvePartnerApplication(
    storeId: number,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const response = await this.prisma.$transaction(async (tx) => {
      const application = await getScopedStorePartnerApplicationOrThrow(
        tx,
        storeId,
        applicationId,
      );

      if (
        application.status !== 'pending' &&
        application.status !== 'reviewing'
      ) {
        throw new ConflictException('当前申请状态不可执行通过操作');
      }

      const now = new Date();
      const updateResult = await tx.storePartnerApplication.updateMany({
        where: {
          id: applicationId,
          storeId,
          status: { in: ['pending', 'reviewing'] },
        },
        data: {
          status: 'approved',
          reviewedAt: now,
          joinedAt: now,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('申请状态已变化，请刷新后重试');
      }

      await upsertApprovedPartnerSnapshot({
        prismaExecutor: tx,
        storeId,
        application,
        approvedAt: now,
      });

      return buildPartnerProfileByStoreId(tx, storeId);
    });

    await this.cacheInvalidatorService.invalidatePulseDashboardHome();

    return response;
  }

  async rejectPartnerApplication(
    storeId: number,
    applicationId: number,
    reason: string,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const response = await this.prisma.$transaction(async (tx) => {
      const application = await getScopedStorePartnerApplicationOrThrow(
        tx,
        storeId,
        applicationId,
      );

      if (
        application.status !== 'pending' &&
        application.status !== 'reviewing'
      ) {
        throw new ConflictException('当前申请状态不可执行驳回操作');
      }

      const now = new Date();
      const updateResult = await tx.storePartnerApplication.updateMany({
        where: {
          id: applicationId,
          storeId,
          status: { in: ['pending', 'reviewing'] },
        },
        data: {
          status: 'rejected',
          reviewedAt: now,
          joinedAt: null,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('申请状态已变化，请刷新后重试');
      }

      await tx.storePartnerApplicationNote.create({
        data: {
          applicationId,
          content: reason,
        },
      });

      return buildPartnerProfileByStoreId(tx, storeId);
    });

    await this.cacheInvalidatorService.invalidatePulseDashboardHome();

    return response;
  }

  async cancelPartnerApplication(
    userId: number,
    storeId: number,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    await ensurePlatformMembershipStoreOwner(this.prisma, userId, storeId);

    const response = await this.prisma.$transaction(async (tx) => {
      const application = await getScopedStorePartnerApplicationOrThrow(
        tx,
        storeId,
        applicationId,
      );

      if (
        application.status !== 'pending' &&
        application.status !== 'reviewing'
      ) {
        throw new ConflictException('当前申请状态不可取消');
      }

      const deleteResult = await tx.storePartnerApplication.deleteMany({
        where: {
          id: applicationId,
          storeId,
          status: { in: ['pending', 'reviewing'] },
        },
      });

      if (deleteResult.count !== 1) {
        throw new ConflictException('申请状态已变化，请刷新后重试');
      }

      return buildPartnerProfileByStoreId(tx, storeId);
    });

    await this.cacheInvalidatorService.invalidatePulseDashboardHome();

    return response;
  }

  async addPartnerFollowUpNote(
    storeId: number,
    applicationId: number,
    dto: CreatePlatformPartnerFollowUpNoteDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const content = dto.content.trim();

    return this.prisma.$transaction(async (tx) => {
      await getScopedStorePartnerApplicationOrThrow(tx, storeId, applicationId);

      await tx.storePartnerApplicationNote.create({
        data: {
          applicationId,
          content,
        },
      });

      return buildPartnerProfileByStoreId(tx, storeId);
    });
  }
}
