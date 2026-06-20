import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import type {
  PulseAdminApprovePartnerApplicationDto,
  PulseAdminRejectPartnerApplicationDto,
} from './dto/pulse-growth-admin.dto';
import { PulseGrowthAccessService } from './growth-access.service';
import { queryAdminPartnerApplicationAccessRecord } from './growth-admin.query';

@Injectable()
export class PulseGrowthAdminPartnerApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly accessService: PulseGrowthAccessService,
  ) {}

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

    await this.invalidatePartnerApplicationDerivedCaches(application.storeId);

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

    await this.invalidatePartnerApplicationDerivedCaches(application.storeId);

    return { success: true };
  }

  private async invalidatePartnerApplicationDerivedCaches(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidatePulseGrowthAdminQueries(),
      this.cacheInvalidatorService.invalidatePulseGrowthEarnings(storeId),
      this.cacheInvalidatorService.invalidatePulseDashboardHome(),
      this.cacheInvalidatorService.invalidatePulseDashboardRevenueDetail(),
      this.cacheInvalidatorService.invalidatePulseDashboardOverview(storeId),
      this.cacheInvalidatorService.invalidatePulseSessionNotification(storeId),
      this.cacheInvalidatorService.invalidatePulseSessionBootstrap(storeId),
      this.cacheInvalidatorService.invalidatePulseOnboardingStatus(storeId),
    ]);
  }
}
