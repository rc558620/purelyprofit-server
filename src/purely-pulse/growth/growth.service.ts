import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ApplyPlatformPartnerDto } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type {
  PlatformMembershipPartnerProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import type { ApplyWithdrawalResponseDto } from '../../purely-profit/member/withdrawals/dto/withdrawal-response.dto';
import type {
  GetPulseAdminPartnerApplicationsQueryDto,
  GetPulseAdminPayoutsQueryDto,
  GetPulseEarningsLogsQueryDto,
  PulseAdminApprovePartnerApplicationDto,
  PulseAdminApprovePayoutDto,
  PulseAdminPartnerApplicationsResponseDto,
  PulseAdminPayoutsResponseDto,
  PulseAdminRejectPartnerApplicationDto,
  PulseAdminRejectPayoutDto,
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountResponseDto,
  UpdatePulseWithdrawalAccountDto,
} from './dto/pulse-growth.dto';
import { PulseGrowthAccessService } from './growth-access.service';
import type { PulseAdminPromoDetailResponse } from './growth-admin.domain';
import { PulseGrowthAdminService } from './growth-admin.service';
import { PulseGrowthEarningsService } from './growth-earnings.service';

@Injectable()
export class PulseGrowthService {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly accessService: PulseGrowthAccessService,
    private readonly adminService: PulseGrowthAdminService,
    private readonly earningsService: PulseGrowthEarningsService,
  ) {}

  async getPromoCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    const store = await this.accessService.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看增长中心',
    });
    return this.platformMembershipService.getPromoCenterByStoreId(store.id);
  }

  getAdminPromoDetail(
    user: AuthenticatedUser,
    rawQuery: Record<string, unknown>,
  ): Promise<PulseAdminPromoDetailResponse> {
    return this.adminService.getAdminPromoDetail(user, rawQuery);
  }

  async getPartnerProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const store = await this.accessService.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看合伙人档案',
    });
    return this.platformMembershipService.getPartnerProfileByStoreId(store.id);
  }

  listAdminPartnerApplications(
    user: AuthenticatedUser,
    query: GetPulseAdminPartnerApplicationsQueryDto,
  ): Promise<PulseAdminPartnerApplicationsResponseDto> {
    return this.adminService.listAdminPartnerApplications(user, query);
  }

  approveAdminPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
    dto: PulseAdminApprovePartnerApplicationDto,
  ): Promise<{ success: true }> {
    return this.adminService.approveAdminPartnerApplication(
      user,
      applicationId,
      dto,
    );
  }

  rejectAdminPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
    dto: PulseAdminRejectPartnerApplicationDto,
  ): Promise<{ success: true }> {
    return this.adminService.rejectAdminPartnerApplication(
      user,
      applicationId,
      dto,
    );
  }

  async applyPartner(
    user: AuthenticatedUser,
    dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    void dto;

    await this.accessService.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法发起合伙人申请',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家提交合伙人申请',
    );
  }

  async cancelPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    void applicationId;

    await this.accessService.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法操作合伙人申请',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家撤销合伙人申请',
    );
  }

  getEarningsOverview(
    user: AuthenticatedUser,
  ): Promise<PulseEarningsOverviewResponseDto> {
    return this.earningsService.getEarningsOverview(user);
  }

  getEarningsLogs(
    user: AuthenticatedUser,
    query: GetPulseEarningsLogsQueryDto = {},
  ): Promise<PulseEarningsLogsResponseDto> {
    return this.earningsService.getEarningsLogs(user, query);
  }

  listAdminPayouts(
    user: AuthenticatedUser,
    query: GetPulseAdminPayoutsQueryDto,
  ): Promise<PulseAdminPayoutsResponseDto> {
    return this.adminService.listAdminPayouts(user, query);
  }

  approveAdminPayout(
    user: AuthenticatedUser,
    payoutId: number,
    dto: PulseAdminApprovePayoutDto,
  ): Promise<{ success: true }> {
    return this.adminService.approveAdminPayout(user, payoutId, dto);
  }

  rejectAdminPayout(
    user: AuthenticatedUser,
    payoutId: number,
    dto: PulseAdminRejectPayoutDto,
  ): Promise<{ success: true }> {
    return this.adminService.rejectAdminPayout(user, payoutId, dto);
  }

  getWithdrawalAccount(
    user: AuthenticatedUser,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    return this.earningsService.getWithdrawalAccount(user);
  }

  updateWithdrawalAccount(
    user: AuthenticatedUser,
    dto: UpdatePulseWithdrawalAccountDto,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    return this.earningsService.updateWithdrawalAccount(user, dto);
  }

  applyWithdrawal(
    user: AuthenticatedUser,
    beanAmount: number,
    partnerId?: string,
  ): Promise<ApplyWithdrawalResponseDto> {
    return this.earningsService.applyWithdrawal(user, beanAmount, partnerId);
  }
}
