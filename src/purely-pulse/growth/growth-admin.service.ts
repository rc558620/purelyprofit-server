import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type {
  GetPulseAdminPartnerApplicationsQueryDto,
  GetPulseAdminPayoutsQueryDto,
  PulseAdminApprovePartnerApplicationDto,
  PulseAdminApprovePayoutDto,
  PulseAdminPartnerApplicationsResponseDto,
  PulseAdminPayoutsResponseDto,
  PulseAdminRejectPartnerApplicationDto,
  PulseAdminRejectPayoutDto,
} from './dto/pulse-growth-admin.dto';
import type { PulseAdminPromoDetailResponse } from './growth-admin.domain';
import { PulseGrowthAdminPartnerApplicationService } from './growth-admin-partner-application.service';
import { PulseGrowthAdminPayoutService } from './growth-admin-payout.service';
import { PulseGrowthAdminQueryService } from './growth-admin-query.service';

@Injectable()
export class PulseGrowthAdminService {
  constructor(
    private readonly queryService: PulseGrowthAdminQueryService,
    private readonly partnerApplicationService: PulseGrowthAdminPartnerApplicationService,
    private readonly payoutService: PulseGrowthAdminPayoutService,
  ) {}

  getAdminPromoDetail(
    user: AuthenticatedUser,
    rawQuery: Record<string, unknown>,
  ): Promise<PulseAdminPromoDetailResponse> {
    return this.queryService.getAdminPromoDetail(user, rawQuery);
  }

  listAdminPartnerApplications(
    user: AuthenticatedUser,
    query: GetPulseAdminPartnerApplicationsQueryDto,
  ): Promise<PulseAdminPartnerApplicationsResponseDto> {
    return this.queryService.listAdminPartnerApplications(user, query);
  }

  approveAdminPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
    dto: PulseAdminApprovePartnerApplicationDto,
  ): Promise<{ success: true }> {
    return this.partnerApplicationService.approveAdminPartnerApplication(
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
    return this.partnerApplicationService.rejectAdminPartnerApplication(
      user,
      applicationId,
      dto,
    );
  }

  listAdminPayouts(
    user: AuthenticatedUser,
    query: GetPulseAdminPayoutsQueryDto,
  ): Promise<PulseAdminPayoutsResponseDto> {
    return this.queryService.listAdminPayouts(user, query);
  }

  approveAdminPayout(
    user: AuthenticatedUser,
    payoutId: number,
    dto: PulseAdminApprovePayoutDto,
  ): Promise<{ success: true }> {
    return this.payoutService.approveAdminPayout(user, payoutId, dto);
  }

  rejectAdminPayout(
    user: AuthenticatedUser,
    payoutId: number,
    dto: PulseAdminRejectPayoutDto,
  ): Promise<{ success: true }> {
    return this.payoutService.rejectAdminPayout(user, payoutId, dto);
  }
}
