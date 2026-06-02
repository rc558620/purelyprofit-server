import { ForbiddenException, Injectable } from '@nestjs/common';
import { IdentityType } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  ApplyPlatformPartnerDto,
  CreatePlatformPartnerFollowUpNoteDto,
  PlatformMembershipPlanId,
  PurchasePlatformMembershipOrderDto,
  RejectPlatformPartnerApplicationDto,
} from './dto/platform-membership-query.dto';
import type {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipPartnerProfileResponseDto,
  PlatformMembershipPlanResponseDto,
  PlatformMembershipPlanRulesResponseDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from './dto/platform-membership-response.dto';
import { PlatformMembershipLedgerService } from './platform-membership-ledger.service';
import { PlatformMembershipOrderService } from './platform-membership-order.service';
import { PlatformMembershipPartnerService } from './platform-membership-partner.service';
import { PlatformMembershipReadService } from './platform-membership-read.service';
import type {
  MembershipPlanConfig,
  PromotionDetailCompatResponse,
} from './platform-membership.types';

@Injectable()
export class PlatformMembershipService {
  constructor(
    private readonly platformMembershipReadService: PlatformMembershipReadService,
    private readonly platformMembershipLedgerService: PlatformMembershipLedgerService,
    private readonly platformMembershipPartnerService: PlatformMembershipPartnerService,
    private readonly platformMembershipOrderService: PlatformMembershipOrderService,
  ) {}

  async listPlans(): Promise<PlatformMembershipPlanResponseDto[]> {
    return this.platformMembershipReadService.listPlans();
  }

  async getPlanConfig(
    planId: PlatformMembershipPlanId,
  ): Promise<MembershipPlanConfig> {
    return this.platformMembershipReadService.getPlanConfig(planId);
  }

  listPlanRules(): PlatformMembershipPlanRulesResponseDto {
    return this.platformMembershipReadService.listPlanRules();
  }

  async getCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipCenterResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipReadService.getCenterByStoreId(storeId);
  }

  async getCenterByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipCenterResponseDto> {
    return this.platformMembershipReadService.getCenterByStoreId(storeId);
  }

  async getProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipProfileResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipReadService.getProfileByStoreId(storeId);
  }

  async getProfileByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipProfileResponseDto> {
    return this.platformMembershipReadService.getProfileByStoreId(storeId);
  }

  async listOrders(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipReadService.listOrdersByStoreId(storeId);
  }

  async listOrdersByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    return this.platformMembershipReadService.listOrdersByStoreId(storeId);
  }

  async purchaseOrder(
    user: AuthenticatedUser,
    dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipOrderService.purchaseOrder(
      user.id,
      storeId,
      dto,
    );
  }

  async listPointsLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipLedgerService.listPointsLogsByStoreId(
      storeId,
    );
  }

  async listPointsLogsByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    return this.platformMembershipLedgerService.listPointsLogsByStoreId(
      storeId,
    );
  }

  async listBeanLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipLedgerService.listBeanLogsByStoreId(storeId);
  }

  async listBeanLogsByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    return this.platformMembershipLedgerService.listBeanLogsByStoreId(storeId);
  }

  async getPromoCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipReadService.getPromoCenterByStoreId(storeId);
  }

  async getPromoCenterByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.platformMembershipReadService.getPromoCenterByStoreId(storeId);
  }

  async getPromotionDetailCompat(
    user: AuthenticatedUser,
    rawQuery: Record<string, unknown>,
  ): Promise<PromotionDetailCompatResponse> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipReadService.getPromotionDetailCompat(
      storeId,
      rawQuery,
    );
  }

  async getPartnerProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.getPartnerProfileByStoreId(storeId);
  }

  async getPartnerProfileByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipPartnerService.getPartnerProfileByStoreId(
      storeId,
    );
  }

  async applyPartner(
    user: AuthenticatedUser,
    dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipPartnerService.applyPartner(
      user.id,
      storeId,
      dto,
    );
  }

  async markPartnerApplicationReviewing(
    user: AuthenticatedUser,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipPartnerService.markPartnerApplicationReviewing(
      storeId,
      applicationId,
    );
  }

  async approvePartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipPartnerService.approvePartnerApplication(
      storeId,
      applicationId,
    );
  }

  async rejectPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
    dto: RejectPlatformPartnerApplicationDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipPartnerService.rejectPartnerApplication(
      storeId,
      applicationId,
      dto.reason.trim(),
    );
  }

  async cancelPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipPartnerService.cancelPartnerApplication(
      user.id,
      storeId,
      applicationId,
    );
  }

  async addPartnerFollowUpNote(
    user: AuthenticatedUser,
    applicationId: number,
    dto: CreatePlatformPartnerFollowUpNoteDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipPartnerService.addPartnerFollowUpNote(
      storeId,
      applicationId,
      dto,
    );
  }

  private getCurrentStoreIdOrThrow(user: AuthenticatedUser): number {
    const storeId = user.currentMembership?.storeId;
    if (!storeId) {
      throw new ForbiddenException('当前账号未绑定门店，暂无法使用会员中心');
    }

    return storeId;
  }

  private ensureOwnerOnly(user: AuthenticatedUser, message: string): void {
    if (
      user.currentMembership?.subjectType === ('sub_account' as IdentityType)
    ) {
      throw new ForbiddenException(message);
    }
  }
}
