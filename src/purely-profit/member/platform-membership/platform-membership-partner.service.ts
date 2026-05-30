import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/cache-invalidator.service';
import {
  ApplyPlatformPartnerDto,
  type CreatePlatformPartnerFollowUpNoteDto,
} from './dto/platform-membership-query.dto';
import type { PlatformMembershipPartnerProfileResponseDto } from './dto/platform-membership-response.dto';
import {
  buildPartnerApplicationPayload,
  buildPartnerProfileResponse,
} from './platform-membership-partner.domain';
import {
  ensurePlatformMembershipStoreOwner,
  findStoreMembershipPromoRecords,
  findStorePartnerApplications,
  findStorePartnerByApplicant,
  findStorePartners,
  getScopedStorePartnerApplicationOrThrow,
} from './platform-membership.query';
import type {
  PartnerSnapshotPayload,
  PrismaExecutor,
  StorePartnerApplicationRecord,
  StorePartnerRecord,
} from './platform-membership.types';

@Injectable()
export class PlatformMembershipPartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

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

    const [approvedPartners, applications] = await Promise.all([
      findStorePartners(this.prisma, storeId),
      findStorePartnerApplications(this.prisma, storeId),
    ]);
    const payload = buildPartnerApplicationPayload(dto);

    if (this.hasApprovedPartnerForApplicant(approvedPartners, payload)) {
      throw new ConflictException('该合伙人已通过审核，无需重复申请');
    }

    const blockingApplication = this.findBlockingApplication(
      applications,
      payload,
    );

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

      return this.buildPartnerProfile(tx, storeId);
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

      return this.buildPartnerProfile(tx, storeId);
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

      await this.upsertApprovedPartnerSnapshot(tx, storeId, application, now);

      return this.buildPartnerProfile(tx, storeId);
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

      return this.buildPartnerProfile(tx, storeId);
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

      return this.buildPartnerProfile(tx, storeId);
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

      return this.buildPartnerProfile(tx, storeId);
    });
  }

  private async buildPartnerProfile(
    prismaExecutor: PrismaExecutor,
    storeId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const [partners, promoRecords, applications] = await Promise.all([
      findStorePartners(prismaExecutor, storeId),
      findStoreMembershipPromoRecords(prismaExecutor, storeId),
      findStorePartnerApplications(prismaExecutor, storeId),
    ]);

    return buildPartnerProfileResponse({
      partners,
      promoRecords,
      applications,
    });
  }

  private findBlockingApplication(
    applications: StorePartnerApplicationRecord[],
    payload: PartnerSnapshotPayload,
  ): StorePartnerApplicationRecord | null {
    return (
      applications.find(
        (application) =>
          this.isSameApplicant(application, payload) &&
          (application.status === 'pending' ||
            application.status === 'reviewing' ||
            application.status === 'approved'),
      ) ?? null
    );
  }

  private hasApprovedPartnerForApplicant(
    partners: StorePartnerRecord[],
    payload: PartnerSnapshotPayload,
  ): boolean {
    return partners.some((partner) => this.isSameApplicant(partner, payload));
  }

  private isSameApplicant(
    applicant:
      | Pick<StorePartnerApplicationRecord, 'idCard' | 'phone'>
      | Pick<StorePartnerRecord, 'idCard' | 'phone'>,
    payload: Pick<PartnerSnapshotPayload, 'idCard' | 'phone'>,
  ): boolean {
    const normalizedIdCard = applicant.idCard?.trim().toUpperCase();

    if (normalizedIdCard) {
      return normalizedIdCard === payload.idCard;
    }

    return applicant.phone?.trim() === payload.phone;
  }

  private async upsertApprovedPartnerSnapshot(
    prismaExecutor: PrismaExecutor,
    storeId: number,
    application: StorePartnerApplicationRecord,
    approvedAt: Date,
  ): Promise<void> {
    const payload = this.toPartnerSnapshotPayload(application);
    const existingPartner = await findStorePartnerByApplicant(
      prismaExecutor,
      storeId,
      payload,
    );

    if (existingPartner) {
      await prismaExecutor.storePartner.update({
        where: { id: existingPartner.id },
        data: {
          ...payload,
          status: 'approved',
          reviewedAt: approvedAt,
          joinedAt: approvedAt,
        },
      });
      return;
    }

    await prismaExecutor.storePartner.create({
      data: {
        storeId,
        status: 'approved',
        ...payload,
        beanBalance: 0,
        totalEarnedBeans: 0,
        totalWithdrawnBeans: 0,
        reviewedAt: approvedAt,
        joinedAt: approvedAt,
      },
    });
  }

  private toPartnerSnapshotPayload(
    application: Pick<
      StorePartnerApplicationRecord,
      | 'name'
      | 'phone'
      | 'idCard'
      | 'region'
      | 'intention'
      | 'applyReason'
      | 'paymentAccountType'
      | 'paymentAccountNo'
      | 'paymentAccountName'
    >,
  ): PartnerSnapshotPayload {
    return {
      name: application.name,
      phone: application.phone,
      idCard: application.idCard,
      region: application.region,
      intention: application.intention,
      applyReason: application.applyReason,
      paymentAccountType: application.paymentAccountType,
      paymentAccountNo: application.paymentAccountNo,
      paymentAccountName: application.paymentAccountName,
    };
  }
}
