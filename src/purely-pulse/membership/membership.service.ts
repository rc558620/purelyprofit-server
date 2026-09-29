import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipPlanResponseDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import type { PurchasePlatformMembershipOrderDto } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import type { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import type {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import type { GetPulseAdminMemberRecordsQueryDto } from './dto/pulse-membership-admin-member-records.request.dto';
import type { PulseAdminMemberRecordsResponseDto } from './dto/pulse-membership-admin-member-records.response.dto';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.request.dto';
import type { PulseAdminEmployeeCandidateDto } from './dto/pulse-membership-admin-employee.response.dto';
import type { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import type { PulseAdminMembersResponseDto } from './dto/pulse-membership-admin-members.response.dto';
import type { PulseAdminMemberClubStatsDto } from './dto/pulse-membership-admin-club-stats.response.dto';
import type { PulseAdminMemberSalesStatsDto } from './dto/pulse-membership-admin-sales-stats.response.dto';
import type { PulseMembershipOrderPreviewDto } from './dto/pulse-membership-orders.request.dto';
import type {
  PulseMembershipOrderDetailResponseDto,
  PulseMembershipOrderPayStatusResponseDto,
  PulseMembershipOrderPreviewResponseDto,
} from './dto/pulse-membership-orders.response.dto';
import { PulseMembershipAdminService } from './membership-admin.service';
import { PulseMembershipLedgerService } from './membership-ledger.service';
import { PulseMembershipOrdersService } from './membership-orders.service';
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
export class PulseMembershipService {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly ledgerService: PulseMembershipLedgerService,
    private readonly ordersService: PulseMembershipOrdersService,
    private readonly adminService: PulseMembershipAdminService,
  ) {}

  listPlans(): Promise<PlatformMembershipPlanResponseDto[]> {
    return this.platformMembershipService.listPlans();
  }

  getCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipCenterResponseDto> {
    return this.ordersService.getCenter(user);
  }

  getProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipProfileResponseDto> {
    return this.ordersService.getProfile(user);
  }

  listOrders(
    user: AuthenticatedUser,
    page?: number,
    pageSize?: number,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    return this.ordersService.listOrders(user, page, pageSize);
  }

  purchaseOrder(
    user: AuthenticatedUser,
    dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    return this.ordersService.purchaseOrder(user, dto);
  }

  listPointsLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    return this.ledgerService.listPointsLogs(user);
  }

  listBeanLogs(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    return this.ledgerService.listBeanLogs(user);
  }

  listAdminPointsLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    return this.adminService.listAdminPointsLogs(user, query);
  }

  listAdminBeanLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    return this.adminService.listAdminBeanLogs(user, query);
  }

  listAdminMemberRecords(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberRecordsQueryDto,
  ): Promise<PulseAdminMemberRecordsResponseDto> {
    return this.adminService.listAdminMemberRecords(user, query);
  }

  getPromoCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.ordersService.getPromoCenter(user);
  }

  previewOrder(
    user: AuthenticatedUser,
    dto: PulseMembershipOrderPreviewDto,
  ): Promise<PulseMembershipOrderPreviewResponseDto> {
    return this.ordersService.previewOrder(user, dto);
  }

  getOrder(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<PulseMembershipOrderDetailResponseDto> {
    return this.ordersService.getOrder(user, orderId);
  }

  getOrderPayStatus(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<PulseMembershipOrderPayStatusResponseDto> {
    return this.ordersService.getOrderPayStatus(user, orderId);
  }

  listAdminMembers(
    user: AuthenticatedUser,
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    return this.adminService.listAdminMembers(user, query);
  }

  getAdminMemberDetail(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.adminService.getAdminMemberDetail(user, memberId);
  }

  listAdminMemberEmployeeCandidates(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminEmployeeCandidateDto[]> {
    return this.adminService.listAdminMemberEmployeeCandidates(user, memberId);
  }

  getAdminMemberClubStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberClubStatsDto> {
    return this.adminService.getAdminMemberClubStats(user, memberId);
  }

  getAdminMemberSalesStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberSalesStatsDto> {
    return this.adminService.getAdminMemberSalesStats(user, memberId);
  }

  adjustAdminMemberPoints(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<PulseMemberDetailDto> {
    return this.adminService.adjustAdminMemberPoints(user, memberId, dto);
  }

  adjustAdminMemberBeans(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<PulseMemberDetailDto> {
    return this.adminService.adjustAdminMemberBeans(user, memberId, dto);
  }

  setAdminMemberMembership(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminMembershipMutationInput,
  ): Promise<PulseMemberDetailDto> {
    return this.adminService.setAdminMemberMembership(user, memberId, dto);
  }

  /** 重置会员「首购锁定价」，让运营可在下一次成交时重新锁价 */
  resetAdminMemberLockedPrices(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.adminService.resetAdminMemberLockedPrices(user, memberId);
  }

  /**
   * 会员成交价预览：只算不落库。
   *
   * 设置会员等级弹窗里运营每改一次输入就要看到新的「下次续费价 / 当期应补」，
   * 但前端不做金额计算，所以由后端算好并以展示字符串下发。
   */
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
    return this.adminService.previewAdminMemberPricing(user, memberId, dto);
  }

  /**
   * 读取该会员各档位的续费价现状。
   *
   * 与「设置会员等级」弹窗里的成交价预览不同：这里读的是**已落库**的覆盖价，
   * 运营一打开「调整续费价格」弹窗就能看到这家店现在真实的续费价。
   */
  listAdminMemberRenewalPrices(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminRenewalPriceItem[]> {
    return this.adminService.listAdminMemberRenewalPrices(user, memberId);
  }

  /** 调整续费价格：为每个档位单独议定基础价覆盖（传空即恢复默认价） */
  updateAdminMemberRenewalPrices(
    user: AuthenticatedUser,
    memberId: number,
    items: PulseAdminRenewalPriceUpdateItem[],
  ): Promise<PulseAdminRenewalPriceItem[]> {
    return this.adminService.updateAdminMemberRenewalPrices(
      user,
      memberId,
      items,
    );
  }

  /** 补录 / 撤销存量门店的子账号加价（只动子账号字段，不改成交总额） */
  backfillAdminMemberSubAccountAmount(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountAmountBackfillInput,
  ): Promise<PulseMemberDetailDto> {
    return this.adminService.backfillAdminMemberSubAccountAmount(
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
    return this.adminService.banAdminMember(user, memberId, dto);
  }

  unbanAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.adminService.unbanAdminMember(user, memberId);
  }

  cancelAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.adminService.cancelAdminMember(user, memberId);
  }

  updateAdminMemberSubAccountQuota(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountQuotaMutationInput,
  ): Promise<PulseMemberDetailDto> {
    return this.adminService.updateAdminMemberSubAccountQuota(
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
    return this.adminService.updateAdminMemberSubAccountSlot(
      user,
      memberId,
      dto,
    );
  }
}
