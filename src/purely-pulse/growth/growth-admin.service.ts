import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PartnerWithdrawalStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  GetPulseAdminPartnerApplicationsQueryDto,
  GetPulseAdminPayoutsQueryDto,
  PulseAdminApprovePartnerApplicationDto,
  PulseAdminApprovePayoutDto,
  PulseAdminPartnerApplicationsResponseDto,
  PulseAdminPayoutsResponseDto,
  PulseAdminRejectPartnerApplicationDto,
  PulseAdminRejectPayoutDto,
} from './dto/pulse-growth.dto';
import { PulseGrowthAccessService } from './growth-access.service';
import {
  buildAdminPartnerApplicationsResponse,
  buildAdminPayoutsResponse,
  buildAdminPromoDetailResponse,
  resolvePromoDateRange,
} from './growth-admin.domain';
import type { PulseAdminPromoDetailResponse } from './growth-admin.domain';
import {
  queryAdminPartnerApplicationAccessRecord,
  queryAdminPartnerApplications,
  queryAdminPayoutActionRecord,
  queryAdminPayouts,
  queryAdminPromoPartners,
} from './growth-admin.query';

@Injectable()
export class PulseGrowthAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly accessService: PulseGrowthAccessService,
  ) {}

  async getAdminPromoDetail(
    user: AuthenticatedUser,
    rawQuery: Record<string, unknown>,
  ): Promise<PulseAdminPromoDetailResponse> {
    const storeWhere = await this.accessService.buildAdminStoreWhere(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看推广详情',
    });
    const dateRange = resolvePromoDateRange(rawQuery);
    const partners = await queryAdminPromoPartners(this.prisma, storeWhere);

    return buildAdminPromoDetailResponse(partners, dateRange);
  }

  async listAdminPartnerApplications(
    user: AuthenticatedUser,
    query: GetPulseAdminPartnerApplicationsQueryDto,
  ): Promise<PulseAdminPartnerApplicationsResponseDto> {
    const where = await this.accessService.buildPartnerApplicationWhere(user);
    const applications = await queryAdminPartnerApplications(
      this.prisma,
      where,
    );

    return buildAdminPartnerApplicationsResponse(applications, query.tab);
  }

  async approveAdminPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
    dto: PulseAdminApprovePartnerApplicationDto,
  ): Promise<{ success: true }> {
    const application = await queryAdminPartnerApplicationAccessRecord(
      this.prisma,
      applicationId,
    );

    if (!application) {
      throw new NotFoundException('合伙人申请不存在');
    }

    await this.accessService.assertCanAccessAdminStore(
      user,
      application.storeId,
      '合伙人申请不存在',
    );
    const scopedUser = this.accessService.buildScopedUser(
      user,
      application.storeId,
    );

    await this.platformMembershipService.approvePartnerApplication(
      scopedUser,
      applicationId,
    );

    const note = dto.note?.trim();
    if (note) {
      await this.platformMembershipService.addPartnerFollowUpNote(
        scopedUser,
        applicationId,
        {
          content: note,
        },
      );
    }

    return { success: true };
  }

  async rejectAdminPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
    dto: PulseAdminRejectPartnerApplicationDto,
  ): Promise<{ success: true }> {
    const application = await queryAdminPartnerApplicationAccessRecord(
      this.prisma,
      applicationId,
    );

    if (!application) {
      throw new NotFoundException('合伙人申请不存在');
    }

    await this.accessService.assertCanAccessAdminStore(
      user,
      application.storeId,
      '合伙人申请不存在',
    );

    await this.platformMembershipService.rejectPartnerApplication(
      this.accessService.buildScopedUser(user, application.storeId),
      applicationId,
      { reason: dto.reason },
    );

    return { success: true };
  }

  async listAdminPayouts(
    user: AuthenticatedUser,
    query: GetPulseAdminPayoutsQueryDto,
  ): Promise<PulseAdminPayoutsResponseDto> {
    const where = await this.accessService.buildAdminPayoutWhere(user);
    const withdrawals = await queryAdminPayouts(this.prisma, where);

    return buildAdminPayoutsResponse(withdrawals, query.tab);
  }

  async approveAdminPayout(
    user: AuthenticatedUser,
    payoutId: number,
    _dto: PulseAdminApprovePayoutDto,
  ): Promise<{ success: true }> {
    const record = await queryAdminPayoutActionRecord(this.prisma, payoutId);

    if (!record) {
      throw new NotFoundException('打款申请不存在');
    }

    await this.accessService.assertCanAccessAdminStore(
      user,
      record.storeId,
      '打款申请不存在',
    );

    if (
      record.status !== PartnerWithdrawalStatus.pending &&
      record.status !== PartnerWithdrawalStatus.approved
    ) {
      throw new ConflictException('当前打款申请状态不可执行确认打款');
    }

    const now = new Date();
    const updateResult = await this.prisma.partnerWithdrawal.updateMany({
      where: {
        id: payoutId,
        storeId: record.storeId,
        status: {
          in: [
            PartnerWithdrawalStatus.pending,
            PartnerWithdrawalStatus.approved,
          ],
        },
      },
      data: {
        status: PartnerWithdrawalStatus.paid,
        reviewedAt: now,
        paidAt: now,
        rejectReason: null,
      },
    });

    if (updateResult.count !== 1) {
      throw new ConflictException('打款申请状态已变化，请刷新后重试');
    }

    return { success: true };
  }

  async rejectAdminPayout(
    user: AuthenticatedUser,
    payoutId: number,
    dto: PulseAdminRejectPayoutDto,
  ): Promise<{ success: true }> {
    const record = await queryAdminPayoutActionRecord(this.prisma, payoutId);

    if (!record) {
      throw new NotFoundException('打款申请不存在');
    }

    await this.accessService.assertCanAccessAdminStore(
      user,
      record.storeId,
      '打款申请不存在',
    );

    if (
      record.status !== PartnerWithdrawalStatus.pending &&
      record.status !== PartnerWithdrawalStatus.approved
    ) {
      throw new ConflictException('当前打款申请状态不可执行拒绝操作');
    }

    const rejectReason = dto.rejectReason.trim();
    if (!rejectReason) {
      throw new ConflictException('拒绝原因不能为空');
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updateResult = await tx.partnerWithdrawal.updateMany({
        where: {
          id: payoutId,
          storeId: record.storeId,
          status: {
            in: [
              PartnerWithdrawalStatus.pending,
              PartnerWithdrawalStatus.approved,
            ],
          },
        },
        data: {
          status: PartnerWithdrawalStatus.rejected,
          reviewedAt: now,
          paidAt: null,
          rejectReason,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('打款申请状态已变化，请刷新后重试');
      }

      const partnerUpdateResult = await tx.storePartner.updateMany({
        where: {
          id: record.partnerId,
          storeId: record.storeId,
          totalWithdrawnBeans: { gte: record.beanAmount },
        },
        data: {
          beanBalance: { increment: record.beanAmount },
          totalWithdrawnBeans: { decrement: record.beanAmount },
        },
      });

      if (partnerUpdateResult.count !== 1) {
        throw new ConflictException('合伙人余额更新失败，请稍后重试');
      }

      await tx.storePartnerBeanLog.create({
        data: {
          storeId: record.storeId,
          partnerId: record.partnerId,
          source: 'admin_adjust',
          changeAmount: record.beanAmount,
          description: `打款驳回退回 · ${record.beanAmount} 豆已退回`,
        },
      });
    });

    return { success: true };
  }
}
