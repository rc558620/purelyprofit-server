import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import type {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import type { GetPulseAdminMemberRecordsQueryDto } from './dto/pulse-membership-admin-member-records.request.dto';
import type { PulseAdminMemberRecordsResponseDto } from './dto/pulse-membership-admin-member-records.response.dto';
import type { AdjustPulseAdminNewCustomerQuotaDto } from './dto/pulse-membership-admin-new-customer-quota.request.dto';
import type {
  PulseAdminNewCustomerQuotaStoreDto,
  PulseAdminNewCustomerQuotaStoresResponseDto,
} from './dto/pulse-membership-admin-new-customer-quota.response.dto';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.request.dto';
import type { PulseAdminEmployeeCandidateDto } from './dto/pulse-membership-admin-employee.response.dto';
import type { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import type { PulseAdminMembersResponseDto } from './dto/pulse-membership-admin-members.response.dto';
import type { PulseAdminMemberClubStatsDto } from './dto/pulse-membership-admin-club-stats.response.dto';
import type { PulseAdminMemberSalesStatsDto } from './dto/pulse-membership-admin-sales-stats.response.dto';
import { PulseMembershipAdminMemberRecordsService } from './membership-admin-member-records.service';
import { PulseMembershipAdminMutationService } from './membership-admin-mutation.service';
import { PulseMembershipAdminNewCustomerQuotaService } from './membership-admin-new-customer-quota.service';
import { PulseMembershipAdminQueryService } from './membership-admin-query.service';
import { PulseMembershipAdminPricingPreviewService } from './membership-admin-pricing-preview.service';
import { PulseMembershipAdminRenewalPriceService } from './membership-admin-renewal-price.service';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseAdminPricingPreviewResult,
  PulseAdminRenewalPriceItem,
  PulseAdminRenewalPriceUpdateItem,
  PulseAdminStatusMutationInput,
  PulseAdminSubAccountAmountBackfillInput,
  PulseAdminSubAccountQuotaMutationInput,
  PulseAdminSubAccountSlotMutationInput,
  PulseMembershipAdjustmentInput,
} from './membership.types';

@Injectable()
export class PulseMembershipAdminService {
  constructor(
    private readonly queryService: PulseMembershipAdminQueryService,
    private readonly mutationService: PulseMembershipAdminMutationService,
    private readonly pricingPreviewService: PulseMembershipAdminPricingPreviewService,
    private readonly renewalPriceService: PulseMembershipAdminRenewalPriceService,
    private readonly memberRecordsService: PulseMembershipAdminMemberRecordsService,
    private readonly newCustomerQuotaService: PulseMembershipAdminNewCustomerQuotaService,
  ) {}

  /** 新客额度：可访问门店的额度一览 */
  listAdminNewCustomerQuotaStores(
    user: AuthenticatedUser,
  ): Promise<PulseAdminNewCustomerQuotaStoresResponseDto> {
    return this.newCustomerQuotaService.listAdminQuotaStores(user);
  }

  /** 新客额度：增减单个门店的额度（正数发放 / 负数回收） */
  adjustAdminNewCustomerQuota(
    user: AuthenticatedUser,
    storeId: number,
    dto: AdjustPulseAdminNewCustomerQuotaDto,
  ): Promise<PulseAdminNewCustomerQuotaStoreDto> {
    return this.newCustomerQuotaService.adjustAdminQuota(user, storeId, dto);
  }

  listAdminPointsLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    return this.queryService.listAdminPointsLogs(user, query);
  }

  listAdminBeanLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    return this.queryService.listAdminBeanLogs(user, query);
  }

  /**
   * 会员记录管理：跨会员聚合「充值 / 等级设置 / 调整续费 / 子账号设置」四类记录。
   *
   * 与积分流水同源的权限口径，但合并的是四张不同来源的表，游标里因此带上记录类型。
   */
  listAdminMemberRecords(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberRecordsQueryDto,
  ): Promise<PulseAdminMemberRecordsResponseDto> {
    return this.memberRecordsService.listMemberRecords(user, query);
  }

  listAdminMembers(
    user: AuthenticatedUser,
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    return this.queryService.listAdminMembers(user, query);
  }

  getAdminMemberDetail(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.queryService.getAdminMemberDetail(user, memberId);
  }

  listAdminMemberEmployeeCandidates(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminEmployeeCandidateDto[]> {
    return this.queryService.listAdminMemberEmployeeCandidates(user, memberId);
  }

  getAdminMemberClubStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberClubStatsDto> {
    return this.queryService.getAdminMemberClubStats(user, memberId);
  }

  getAdminMemberSalesStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberSalesStatsDto> {
    return this.queryService.getAdminMemberSalesStats(user, memberId);
  }

  adjustAdminMemberPoints(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.adjustAdminMemberPoints(user, memberId, dto);
  }

  adjustAdminMemberBeans(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.adjustAdminMemberBeans(user, memberId, dto);
  }

  setAdminMemberMembership(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminMembershipMutationInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.setAdminMemberMembership(user, memberId, dto);
  }

  resetAdminMemberLockedPrices(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.resetAdminMemberLockedPrices(user, memberId);
  }

  /** 会员成交价预览：只算不落库，供设置会员等级弹窗实时展示 */
  previewAdminMemberPricing(
    user: AuthenticatedUser,
    memberId: number,
    dto: {
      targetLevel?: PulseAdminMemberLevel;
      priceDisplay?: string;
      subAccountCount?: number;
      subAccountAmountDisplay?: string;
    },
  ): Promise<PulseAdminPricingPreviewResult> {
    return this.pricingPreviewService.preview({
      user,
      storeId: memberId,
      ...dto,
    });
  }

  /** 读取该会员各档位的续费价现状（含是否被覆盖、能否编辑） */
  listAdminMemberRenewalPrices(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminRenewalPriceItem[]> {
    return this.renewalPriceService.listRenewalPrices(user, memberId);
  }

  /**
   * 批量更新续费价覆盖（调整续费价格弹窗提交）。
   *
   * `items` 里 `priceDisplay` 为空的档位即清除覆盖、恢复默认价。
   * 只动覆盖价，不碰成交总额与子账号加价，因此与「设置会员等级」互不干扰。
   */
  updateAdminMemberRenewalPrices(
    user: AuthenticatedUser,
    memberId: number,
    items: PulseAdminRenewalPriceUpdateItem[],
  ): Promise<PulseAdminRenewalPriceItem[]> {
    return this.renewalPriceService.updateRenewalPrices(user, memberId, items);
  }

  /** 补录 / 撤销存量门店的子账号加价（只动子账号字段，不改成交总额） */
  backfillAdminMemberSubAccountAmount(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountAmountBackfillInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.backfillAdminMemberSubAccountAmount(
      user,
      memberId,
      dto,
    );
  }

  banAdminMember(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminStatusMutationInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.banAdminMember(user, memberId, dto);
  }

  unbanAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.unbanAdminMember(user, memberId);
  }

  cancelAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.cancelAdminMember(user, memberId);
  }

  updateAdminMemberSubAccountQuota(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountQuotaMutationInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.updateAdminMemberSubAccountQuota(
      user,
      memberId,
      dto,
    );
  }

  updateAdminMemberSubAccountSlot(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountSlotMutationInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.updateAdminMemberSubAccountSlot(
      user,
      memberId,
      dto,
    );
  }
}
