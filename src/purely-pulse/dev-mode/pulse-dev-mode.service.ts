import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { PulseDashboardPeriodValue } from '../dashboard/dto/pulse-dashboard-query.dto';
import type { PulseSessionUserDto } from '../session/dto/session-bootstrap.dto';
import { PulseDevModeAccessService } from './pulse-dev-mode-access.service';
import { PulseDevModeDashboardService } from './pulse-dev-mode-dashboard.service';
import { PulseDevModeGrowthService } from './pulse-dev-mode-growth.service';
import { PulseDevModeMembershipService } from './pulse-dev-mode-membership.service';
import { PulseDevModeSessionService } from './pulse-dev-mode-session.service';

@Injectable()
export class PulseDevModeService {
  constructor(
    private readonly accessService: PulseDevModeAccessService,
    private readonly sessionService: PulseDevModeSessionService,
    private readonly dashboardService: PulseDevModeDashboardService,
    private readonly membershipService: PulseDevModeMembershipService,
    private readonly growthService: PulseDevModeGrowthService,
  ) {}

  isEnabled(user: AuthenticatedUser): boolean {
    return this.accessService.isEnabled(user);
  }

  throwUnsupported(message: string): never {
    return this.accessService.throwUnsupported(message);
  }

  buildSessionBootstrap(sessionUser: PulseSessionUserDto) {
    return this.sessionService.buildSessionBootstrap(sessionUser);
  }

  buildOnboardingStatus() {
    return this.sessionService.buildOnboardingStatus();
  }

  buildDashboardOverview(period: PulseDashboardPeriodValue) {
    return this.dashboardService.buildDashboardOverview(period);
  }

  buildDashboardStores(period: PulseDashboardPeriodValue) {
    return this.dashboardService.buildDashboardStores(period);
  }

  buildDashboardAnalysis() {
    return this.dashboardService.buildDashboardAnalysis();
  }

  buildMembershipProfile(user: AuthenticatedUser) {
    return this.membershipService.buildMembershipProfile(user);
  }

  buildMembershipCenter(user: AuthenticatedUser) {
    return this.membershipService.buildMembershipCenter(user);
  }

  buildMembershipOrders() {
    return this.membershipService.buildMembershipOrders();
  }

  buildMembershipPointsLogs(user: AuthenticatedUser) {
    return this.membershipService.buildMembershipPointsLogs(user);
  }

  buildMembershipBeanLogs() {
    return this.membershipService.buildMembershipBeanLogs();
  }

  buildPromoCenter(user: AuthenticatedUser) {
    return this.membershipService.buildPromoCenter(user);
  }

  buildPartnerProfile() {
    return this.membershipService.buildPartnerProfile();
  }

  buildEarningsOverview() {
    return this.growthService.buildEarningsOverview();
  }

  buildEarningsLogs() {
    return this.growthService.buildEarningsLogs();
  }

  buildWithdrawalAccount() {
    return this.growthService.buildWithdrawalAccount();
  }
}
