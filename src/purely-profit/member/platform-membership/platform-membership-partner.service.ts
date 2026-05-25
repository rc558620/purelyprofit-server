import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ApplyPlatformPartnerDto,
  type CreatePlatformPartnerFollowUpNoteDto,
} from './dto/platform-membership-query.dto';
import type { PlatformMembershipPartnerProfileResponseDto } from './dto/platform-membership-response.dto';
import {
  buildCurrentPartnerApplication,
  buildPartnerApplicationPayload,
  buildPartnerProfileResponse,
  buildPartnerSnapshotFromApplication,
} from './platform-membership-partner.domain';
import {
  ensurePlatformMembershipStoreOwner,
  findStoreMembershipPromoRecords,
  findStorePartner,
  findStorePartnerApplications,
  getScopedStorePartnerApplicationOrThrow,
} from './platform-membership.query';
import type {
  PartnerSnapshotPayload,
  PartnerStatusValue,
  PrismaExecutor,
} from './platform-membership.types';

@Injectable()
export class PlatformMembershipPartnerService {
  constructor(private readonly prisma: PrismaService) {}

  async getPartnerProfileByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.buildPartnerProfile(this.prisma, storeId);
  }

  async applyPartner(
    userId: number,
    storeId: number,
    dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    await ensurePlatformMembershipStoreOwner(this.prisma, userId, storeId);

    const [existingPartner, applications] = await Promise.all([
      findStorePartner(this.prisma, storeId),
      findStorePartnerApplications(this.prisma, storeId),
    ]);
    const currentApplication = buildCurrentPartnerApplication(
      applications,
      existingPartner,
    );

    if (existingPartner?.status === 'approved') {
      throw new ConflictException('当前门店已成为合伙人，无需重复申请');
    }

    if (
      currentApplication &&
      (currentApplication.status === 'pending' ||
        currentApplication.status === 'reviewing')
    ) {
      throw new ConflictException('当前已有申请在审核中，请耐心等待');
    }

    const payload = buildPartnerApplicationPayload(dto);

    return this.prisma.$transaction(async (tx) => {
      await tx.storePartnerApplication.create({
        data: {
          storeId,
          status: 'pending',
          ...payload,
        },
      });

      await this.syncPartnerSnapshot(tx, storeId, payload, {
        status: 'pending',
        reviewedAt: null,
        joinedAt: null,
      });

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  async markPartnerApplicationReviewing(
    storeId: number,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.prisma.$transaction(async (tx) => {
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

      await this.syncPartnerSnapshot(tx, storeId, application, {
        status: 'reviewing',
        reviewedAt: null,
        joinedAt: null,
      });

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  async approvePartnerApplication(
    storeId: number,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.prisma.$transaction(async (tx) => {
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

      await this.syncPartnerSnapshot(tx, storeId, application, {
        status: 'approved',
        reviewedAt: now,
        joinedAt: now,
      });

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  async rejectPartnerApplication(
    storeId: number,
    applicationId: number,
    reason: string,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.prisma.$transaction(async (tx) => {
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

      await this.syncPartnerSnapshot(tx, storeId, application, {
        status: 'rejected',
        reviewedAt: now,
        joinedAt: null,
      });

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  async cancelPartnerApplication(
    userId: number,
    storeId: number,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    await ensurePlatformMembershipStoreOwner(this.prisma, userId, storeId);

    return this.prisma.$transaction(async (tx) => {
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

      const remainingApplications = await findStorePartnerApplications(
        tx,
        storeId,
      );
      const latestApplication = remainingApplications[0];

      if (latestApplication) {
        await this.syncPartnerSnapshot(
          tx,
          storeId,
          buildPartnerSnapshotFromApplication(latestApplication),
          {
            status: latestApplication.status,
            reviewedAt: latestApplication.reviewedAt,
            joinedAt: latestApplication.joinedAt,
          },
        );
      } else {
        await tx.storePartner.deleteMany({
          where: {
            storeId,
            status: { in: ['pending', 'reviewing', 'rejected'] },
          },
        });
      }

      return this.buildPartnerProfile(tx, storeId);
    });
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

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  private async buildPartnerProfile(
    prismaExecutor: PrismaExecutor,
    storeId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const [partner, promoRecords, applications] = await Promise.all([
      findStorePartner(prismaExecutor, storeId),
      findStoreMembershipPromoRecords(prismaExecutor, storeId),
      findStorePartnerApplications(prismaExecutor, storeId),
    ]);

    return buildPartnerProfileResponse({
      partner,
      promoRecords,
      applications,
    });
  }

  private async syncPartnerSnapshot(
    prismaExecutor: PrismaExecutor,
    storeId: number,
    payload: PartnerSnapshotPayload,
    statusSnapshot: {
      status: PartnerStatusValue;
      reviewedAt: Date | null;
      joinedAt: Date | null;
    },
  ): Promise<void> {
    await prismaExecutor.storePartner.upsert({
      where: { storeId },
      create: {
        storeId,
        ...payload,
        status: statusSnapshot.status,
        reviewedAt: statusSnapshot.reviewedAt,
        joinedAt: statusSnapshot.joinedAt,
      },
      update: {
        ...payload,
        status: statusSnapshot.status,
        reviewedAt: statusSnapshot.reviewedAt,
        joinedAt: statusSnapshot.joinedAt,
      },
    });
  }
}
