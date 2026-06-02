import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { STORE_SUB_ACCOUNT_ROLE_LABELS } from '../../access-control/access-control.constants';
import { SubjectCapabilityService } from '../../access-control/subject-capability.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildProfitDashboardHomeCacheKey } from '../../../redis/cache-keys';
import { RedisService } from '../../../redis/redis.service';
import type { GetDashboardHomeOverviewQueryDto } from './dto/dashboard-home-query.dto';
import type { DashboardHomeOverviewResponseDto } from './dto/dashboard-home-response.dto';
import {
  buildDashboardHomeOverviewResponse,
  type DashboardHomeOverviewWithoutCapability,
} from './dashboard-home.mapper';
import { loadDashboardHomeOverviewData } from './dashboard-home.query';
import {
  buildCompareRange,
  buildCurrentRange,
  buildDashboardHomeQueryInput,
} from './dashboard-home.utils';

const PROFIT_DASHBOARD_HOME_CACHE_TTL_SECONDS = 30;

@Injectable()
export class DashboardHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly subjectCapabilityService: SubjectCapabilityService,
    private readonly storeSubAccountService: StoreSubAccountService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    queryDto: GetDashboardHomeOverviewQueryDto,
  ): Promise<DashboardHomeOverviewResponseDto> {
    const query = buildDashboardHomeQueryInput(queryDto);
    const period = query.period ?? 'today';
    const capabilitySnapshot = await this.buildCapabilitySnapshot(
      user,
      user.currentMembership?.storeId ?? query.storeId ?? 0,
    );
    const requiredPermission = capabilitySnapshot.canAccessDashboardOverview
      ? 'operation-entry:view'
      : 'report:view';
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      requiredPermission,
      '无权查看该门店首页概览',
    );

    const cachedResponse =
      await this.redisService.getJson<DashboardHomeOverviewWithoutCapability>(
        buildProfitDashboardHomeCacheKey(storeId, period),
      );

    if (cachedResponse !== null) {
      return { ...cachedResponse, capability: capabilitySnapshot };
    }

    const response = await this.warmOverviewCache(storeId, period);
    return { ...response, capability: capabilitySnapshot };
  }

  async warmOverviewCache(
    storeId: number,
    period: NonNullable<GetDashboardHomeOverviewQueryDto['period']> | 'today',
  ): Promise<DashboardHomeOverviewWithoutCapability> {
    const cacheKey = buildProfitDashboardHomeCacheKey(storeId, period);
    const currentRange = buildCurrentRange(period);
    const compareRange = buildCompareRange(period, currentRange);
    const now = Date.now();
    const overviewData = await loadDashboardHomeOverviewData(this.prisma, {
      storeId,
      currentRange,
      compareRange,
      now,
    });

    const response = buildDashboardHomeOverviewResponse({
      period,
      storeId,
      currentRange,
      compareRange,
      now,
      overviewData,
    });

    await this.redisService.setJson(
      cacheKey,
      response,
      PROFIT_DASHBOARD_HOME_CACHE_TTL_SECONDS,
    );

    return response;
  }

  private async buildCapabilitySnapshot(
    user: AuthenticatedUser,
    storeId: number,
  ) {
    const subAccountSummary =
      await this.storeSubAccountService.getStoreSubAccountSummary(storeId);
    const snapshot = this.subjectCapabilityService.buildSnapshot(
      user.currentMembership,
      subAccountSummary.quota,
    );

    return {
      identityType: snapshot.identityType,
      subAccountRole: snapshot.subAccountRole ?? undefined,
      subAccountRoleLabel: snapshot.subAccountRole
        ? STORE_SUB_ACCOUNT_ROLE_LABELS[snapshot.subAccountRole]
        : undefined,
      allowedHomeModules: snapshot.allowedHomeModules,
      hiddenHomeModules: snapshot.hiddenHomeModules,
      canViewFinance: snapshot.canViewFinance,
      canViewMarketing: snapshot.canViewMarketing,
      ...(user.currentMembership?.subAccountStatus
        ? { subAccountStatus: user.currentMembership.subAccountStatus }
        : {}),
      ...(user.currentMembership?.subAccountAssigned !== undefined
        ? { subAccountAssigned: user.currentMembership.subAccountAssigned }
        : {}),
      ...(user.currentMembership?.canAccessHome !== undefined
        ? { canAccessHome: user.currentMembership.canAccessHome }
        : {}),
      ...(user.currentMembership?.canUseHandover !== undefined
        ? { canUseHandover: user.currentMembership.canUseHandover }
        : {}),
      canUseHandoverManagement: snapshot.canUseHandoverManagement,
      canUseSpaceManagement: snapshot.canUseSpaceManagement,
      canAccessStoreSettings: snapshot.canAccessStoreSettings,
      canAccessDashboardOverview:
        snapshot.allowedHomeModules.includes('additional') &&
        user.currentMembership?.canAccessHome !== false,
    };
  }
}
