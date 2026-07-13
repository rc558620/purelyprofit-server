import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import {
  ApplyPlatformPartnerDto,
  type CreatePlatformPartnerFollowUpNoteDto,
} from './dto/platform-membership-query.dto';
import type { PlatformMembershipPartnerProfileResponseDto } from './dto/platform-membership-response.dto';
import { buildPartnerApplicationPayload } from './platform-membership-partner.domain';
import {
  findBlockingApplication,
  upsertApprovedPartnerSnapshot,
} from './platform-membership-partner-application.domain';
import { buildPartnerProfileByStoreId } from './platform-membership-partner-profile.domain';
import {
  ensurePlatformMembershipStoreOwner,
  findCurrentStorePartner,
  findStorePartnerApplications,
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

    const payload = buildPartnerApplicationPayload(dto);

    // 查询与拦截都收口到同一事务内，避免“先查后写”的并发竞态导致重复申请
    const response = await this.prisma.$transaction(async (tx) => {
      const [partner, applications] = await Promise.all([
        findCurrentStorePartner(tx, storeId),
        findStorePartnerApplications(tx, storeId),
      ]);

      // 一个账号（即门店老板）只能有一个合伙人：门店已存在正式合伙人则禁止再次申请
      if (partner) {
        throw new ConflictException('该合伙人已通过审核，无需重复申请');
      }

      // 门店存在待审核/审核中/已通过的申请时也禁止重复提交；
      // 仅当全部申请均为“已驳回”时才允许重新申请（见 member-partners 缺陷排查）。
      const blockingApplication =
        findBlockingApplication(applications, payload) ??
        applications.find(
          (application) =>
            application.status === 'pending' ||
            application.status === 'reviewing' ||
            application.status === 'approved',
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

      await tx.storePartnerApplication.create({
        data: {
          storeId,
          status: 'pending',
          ...payload,
        },
      });

      return buildPartnerProfileByStoreId(tx, storeId);
    });

    await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);

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

    await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);

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

    await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);

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

    await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);

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

    await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);

    return response;
  }

  async addPartnerFollowUpNote(
    storeId: number,
    applicationId: number,
    dto: CreatePlatformPartnerFollowUpNoteDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const content = dto.content.trim();

    const response = await this.prisma.$transaction(async (tx) => {
      await getScopedStorePartnerApplicationOrThrow(tx, storeId, applicationId);

      await tx.storePartnerApplicationNote.create({
        data: {
          applicationId,
          content,
        },
      });

      return buildPartnerProfileByStoreId(tx, storeId);
    });

    // 新增跟进备注会写入合伙人档案的 followUpNotes，必须失效缓存，
    // 否则 member-partners 页面在缓存 TTL 内看不到新备注（见缺陷排查 Bug 1）。
    await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);

    return response;
  }
}
