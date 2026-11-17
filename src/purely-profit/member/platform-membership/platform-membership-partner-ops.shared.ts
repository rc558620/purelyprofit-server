// 平台会员 · 合伙人子域的对外编排：统一做「仅 owner」权限收口 + 门店上下文绑定
import { ForbiddenException } from '@nestjs/common';
import type { IdentityType } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PlatformMembershipPartnerService } from './platform-membership-partner.service';
import type {
  ApplyPlatformPartnerDto,
  CreatePlatformPartnerFollowUpNoteDto,
  RejectPlatformPartnerApplicationDto,
} from './dto/platform-membership-query.dto';
import type { PlatformMembershipPartnerProfileResponseDto } from './dto/platform-membership-response.dto';

/** 子账号访问平台会员中心的统一拒绝文案 */
export const PLATFORM_MEMBERSHIP_SUB_ACCOUNT_FORBIDDEN_MESSAGE =
  '子账号无权访问平台会员中心';

/** 子账号一律不得访问平台会员中心（与 controller 权限注解形成双保险） */
export const ensurePlatformMembershipOwnerOnly = (
  user: AuthenticatedUser,
  message: string,
): void => {
  if (user.currentMembership?.subjectType === ('sub_account' as IdentityType)) {
    throw new ForbiddenException(message);
  }
};

/** 取当前登录账号绑定的门店 ID，未绑定门店时直接拒绝 */
export const getPlatformMembershipStoreIdOrThrow = (
  user: AuthenticatedUser,
): number => {
  const storeId = user.currentMembership?.storeId;
  if (!storeId) {
    throw new ForbiddenException('当前账号未绑定门店，暂无法使用会员中心');
  }

  return storeId;
};

export const applyPlatformPartner = (
  partnerService: PlatformMembershipPartnerService,
  user: AuthenticatedUser,
  dto: ApplyPlatformPartnerDto,
): Promise<PlatformMembershipPartnerProfileResponseDto> => {
  ensurePlatformMembershipOwnerOnly(
    user,
    PLATFORM_MEMBERSHIP_SUB_ACCOUNT_FORBIDDEN_MESSAGE,
  );
  return partnerService.applyPartner(
    user.id,
    getPlatformMembershipStoreIdOrThrow(user),
    dto,
  );
};

export const markPlatformPartnerApplicationReviewing = (
  partnerService: PlatformMembershipPartnerService,
  user: AuthenticatedUser,
  applicationId: number,
): Promise<PlatformMembershipPartnerProfileResponseDto> => {
  ensurePlatformMembershipOwnerOnly(
    user,
    PLATFORM_MEMBERSHIP_SUB_ACCOUNT_FORBIDDEN_MESSAGE,
  );
  return partnerService.markPartnerApplicationReviewing(
    getPlatformMembershipStoreIdOrThrow(user),
    applicationId,
  );
};

export const approvePlatformPartnerApplication = (
  partnerService: PlatformMembershipPartnerService,
  user: AuthenticatedUser,
  applicationId: number,
): Promise<PlatformMembershipPartnerProfileResponseDto> => {
  ensurePlatformMembershipOwnerOnly(
    user,
    PLATFORM_MEMBERSHIP_SUB_ACCOUNT_FORBIDDEN_MESSAGE,
  );
  return partnerService.approvePartnerApplication(
    getPlatformMembershipStoreIdOrThrow(user),
    applicationId,
  );
};

export const rejectPlatformPartnerApplication = (
  partnerService: PlatformMembershipPartnerService,
  user: AuthenticatedUser,
  applicationId: number,
  dto: RejectPlatformPartnerApplicationDto,
): Promise<PlatformMembershipPartnerProfileResponseDto> => {
  ensurePlatformMembershipOwnerOnly(
    user,
    PLATFORM_MEMBERSHIP_SUB_ACCOUNT_FORBIDDEN_MESSAGE,
  );
  const reason = dto.reason?.trim();
  const finalReason = reason && reason.length > 0 ? reason : '审核未通过';
  return partnerService.rejectPartnerApplication(
    getPlatformMembershipStoreIdOrThrow(user),
    applicationId,
    finalReason,
  );
};

export const cancelPlatformPartnerApplication = (
  partnerService: PlatformMembershipPartnerService,
  user: AuthenticatedUser,
  applicationId: number,
): Promise<PlatformMembershipPartnerProfileResponseDto> => {
  ensurePlatformMembershipOwnerOnly(
    user,
    PLATFORM_MEMBERSHIP_SUB_ACCOUNT_FORBIDDEN_MESSAGE,
  );
  return partnerService.cancelPartnerApplication(
    user.id,
    getPlatformMembershipStoreIdOrThrow(user),
    applicationId,
  );
};

export const addPlatformPartnerFollowUpNote = (
  partnerService: PlatformMembershipPartnerService,
  user: AuthenticatedUser,
  applicationId: number,
  dto: CreatePlatformPartnerFollowUpNoteDto,
): Promise<PlatformMembershipPartnerProfileResponseDto> => {
  ensurePlatformMembershipOwnerOnly(
    user,
    PLATFORM_MEMBERSHIP_SUB_ACCOUNT_FORBIDDEN_MESSAGE,
  );
  return partnerService.addPartnerFollowUpNote(
    getPlatformMembershipStoreIdOrThrow(user),
    applicationId,
    dto,
  );
};
