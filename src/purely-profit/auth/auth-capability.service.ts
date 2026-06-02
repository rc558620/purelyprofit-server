import { Injectable } from '@nestjs/common';
import { STORE_SUB_ACCOUNT_ROLE_LABELS } from '../access-control/access-control.constants';
import { SubjectCapabilityService } from '../access-control/subject-capability.service';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import type { AuthCapabilityResponseDto } from './dto/capability-response.dto';

@Injectable()
export class AuthCapabilityService {
  constructor(
    private readonly subjectCapabilityService: SubjectCapabilityService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getCapability(
    user: AuthenticatedUser,
  ): Promise<AuthCapabilityResponseDto> {
    const storeId = user.currentMembership?.storeId;
    const subAccountQuota = storeId
      ? await this.platformMembershipAccessService.getSubAccountQuota(storeId)
      : 0;
    const snapshot = this.subjectCapabilityService.buildSnapshot(
      user.currentMembership,
      subAccountQuota,
    );

    return {
      identityType: snapshot.identityType,
      ...(snapshot.subAccountRole
        ? {
            subAccountRole: snapshot.subAccountRole,
            subAccountRoleLabel:
              STORE_SUB_ACCOUNT_ROLE_LABELS[snapshot.subAccountRole],
            ...(user.currentMembership?.subAccountStatus
              ? { subAccountStatus: user.currentMembership.subAccountStatus }
              : {}),
            ...(user.currentMembership?.subAccountAssigned !== undefined
              ? {
                  subAccountAssigned: user.currentMembership.subAccountAssigned,
                }
              : {}),
            ...(user.currentMembership?.canAccessHome !== undefined
              ? { canAccessHome: user.currentMembership.canAccessHome }
              : {}),
            ...(user.currentMembership?.canUseHandover !== undefined
              ? { canUseHandover: user.currentMembership.canUseHandover }
              : {}),
          }
        : {}),
      subAccountQuota: snapshot.subAccountQuota,
      subAccountEnabled: snapshot.subAccountEnabled,
      allowedHomeModules: snapshot.allowedHomeModules,
      hiddenHomeModules: snapshot.hiddenHomeModules,
      canViewFinance: snapshot.canViewFinance,
      canViewMarketing: snapshot.canViewMarketing,
      canUseHandoverManagement: snapshot.canUseHandoverManagement,
      canUseSpaceManagement: snapshot.canUseSpaceManagement,
      canAccessStoreSettings: snapshot.canAccessStoreSettings,
    };
  }
}
