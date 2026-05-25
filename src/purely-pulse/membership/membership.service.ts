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
import type {
  GetPulseAdminMembersQueryDto,
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
  PulseAdminMembersResponseDto,
  PulseMemberDetailDto,
  PulseMembershipOrderDetailResponseDto,
  PulseMembershipOrderPayStatusResponseDto,
  PulseMembershipOrderPreviewDto,
  PulseMembershipOrderPreviewResponseDto,
} from './dto/pulse-membership.dto';
import { PulseMembershipAdminService } from './membership-admin.service';
import { PulseMembershipLedgerService } from './membership-ledger.service';
import { PulseMembershipOrdersService } from './membership-orders.service';
import type {
  PulseAdminMembershipMutationInput,
  PulseAdminStatusMutationInput,
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
  ): Promise<PlatformMembershipOrdersResponseDto> {
    return this.ordersService.listOrders(user);
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
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    return this.adminService.listAdminPointsLogs(user);
  }

  listAdminBeanLogs(
    user: AuthenticatedUser,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    return this.adminService.listAdminBeanLogs(user);
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
}
