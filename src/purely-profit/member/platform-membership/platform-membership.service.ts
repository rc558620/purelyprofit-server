import { ForbiddenException, Injectable } from '@nestjs/common';
import { IdentityType } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  buildCacheRefreshTaskKey,
  buildPlatformMembershipBeanLogsCacheKey,
  buildPlatformMembershipCenterCacheKey,
  buildPlatformMembershipPartnerProfileCacheKey,
  buildPlatformMembershipPointsLogsCacheKey,
  buildPlatformMembershipProfileCacheKey,
  buildPlatformMembershipPromoCenterCacheKey,
} from '../../../redis/keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import type {
  ApplyPlatformPartnerDto,
  CreatePlatformPartnerFollowUpNoteDto,
  PlatformMembershipPlanId,
  PreviewPlatformMembershipOrderDto,
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
  PreviewPlatformMembershipOrderResponseDto,
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

const PLATFORM_MEMBERSHIP_READ_CACHE_TTL_SECONDS = 120;
const PLATFORM_MEMBERSHIP_READ_REFRESH_AFTER_MS = 30_000;
const PLATFORM_MEMBERSHIP_LEDGER_CACHE_TTL_SECONDS = 90;
const PLATFORM_MEMBERSHIP_LEDGER_REFRESH_AFTER_MS = 20_000;

@Injectable()
export class PlatformMembershipService {
  constructor(
    private readonly platformMembershipReadService: PlatformMembershipReadService,
    private readonly platformMembershipLedgerService: PlatformMembershipLedgerService,
    private readonly platformMembershipPartnerService: PlatformMembershipPartnerService,
    private readonly platformMembershipOrderService: PlatformMembershipOrderService,
    private readonly refreshableCache: RefreshableCacheService,
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
    return this.getCenterByStoreId(this.getCurrentStoreIdOrThrow(user));
  }

  async getCenterByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipCenterResponseDto> {
    return this.loadCachedRead(
      buildPlatformMembershipCenterCacheKey(storeId),
      () => this.platformMembershipReadService.getCenterByStoreId(storeId),
    );
  }

  async getProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipProfileResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    return this.getProfileByStoreId(this.getCurrentStoreIdOrThrow(user));
  }

  async getProfileByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipProfileResponseDto> {
    return this.loadCachedRead(
      buildPlatformMembershipProfileCacheKey(storeId),
      () => this.platformMembershipReadService.getProfileByStoreId(storeId),
    );
  }

  async listOrders(
    user: AuthenticatedUser,
    page?: number,
    pageSize?: number,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    return this.listOrdersByStoreId(
      this.getCurrentStoreIdOrThrow(user),
      page,
      pageSize,
    );
  }

  async listOrdersByStoreId(
    storeId: number,
    page?: number,
    pageSize?: number,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    return this.platformMembershipReadService.listOrdersByStoreId(
      storeId,
      page,
      pageSize,
    );
  }

  async previewOrder(
    user: AuthenticatedUser,
    dto: PreviewPlatformMembershipOrderDto,
  ): Promise<PreviewPlatformMembershipOrderResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    const storeId = this.getCurrentStoreIdOrThrow(user);
    return this.platformMembershipOrderService.previewOrder(
      user.id,
      storeId,
      dto,
    );
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
    return this.listPointsLogsByStoreId(this.getCurrentStoreIdOrThrow(user));
  }

  async listPointsLogsByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    return this.loadCachedLedger(
      buildPlatformMembershipPointsLogsCacheKey(storeId),
      () =>
        this.platformMembershipLedgerService.listPointsLogsByStoreId(storeId),
    );
  }

  async listBeanLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    return this.listBeanLogsByStoreId(this.getCurrentStoreIdOrThrow(user));
  }

  async listBeanLogsByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    return this.loadCachedLedger(
      buildPlatformMembershipBeanLogsCacheKey(storeId),
      () => this.platformMembershipLedgerService.listBeanLogsByStoreId(storeId),
    );
  }

  async getPromoCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问平台会员中心');
    return this.getPromoCenterByStoreId(this.getCurrentStoreIdOrThrow(user));
  }

  async getPromoCenterByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.loadCachedLedger(
      buildPlatformMembershipPromoCenterCacheKey(storeId),
      () => this.platformMembershipReadService.getPromoCenterByStoreId(storeId),
    );
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
    return this.getPartnerProfileByStoreId(this.getCurrentStoreIdOrThrow(user));
  }

  async getPartnerProfileByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.loadCachedRead(
      buildPlatformMembershipPartnerProfileCacheKey(storeId),
      () =>
        this.platformMembershipPartnerService.getPartnerProfileByStoreId(
          storeId,
        ),
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

  private async loadCachedRead<T>(
    cacheKey: string,
    loadValue: () => Promise<T>,
  ): Promise<T> {
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PLATFORM_MEMBERSHIP_READ_CACHE_TTL_SECONDS,
      refreshAfterMs: PLATFORM_MEMBERSHIP_READ_REFRESH_AFTER_MS,
      loadValue,
    });
  }

  private async loadCachedLedger<T>(
    cacheKey: string,
    loadValue: () => Promise<T>,
  ): Promise<T> {
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PLATFORM_MEMBERSHIP_LEDGER_CACHE_TTL_SECONDS,
      refreshAfterMs: PLATFORM_MEMBERSHIP_LEDGER_REFRESH_AFTER_MS,
      loadValue,
    });
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
