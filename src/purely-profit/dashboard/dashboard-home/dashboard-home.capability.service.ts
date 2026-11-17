import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { STORE_SUB_ACCOUNT_ROLE_LABELS } from '../../access-control/access-control.constants';
import type {
  AuthenticatedMembership,
  IdentityType,
} from '../../access-control/access-control.service';
import {
  SubjectCapabilityService,
  type ProfitHomeModule,
} from '../../access-control/subject-capability.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildProfitDashboardHomeCapabilityCacheKey } from '../../../redis/keys';
import { RedisService } from '../../../redis/redis.service';

/**
 * 能力快照缓存 TTL。
 *
 * 该快照只驱动前端 UI 的能力展示，安全裁决由 PermissionsGuard 与
 * resolveSingleStoreId 完成，因此允许一个与概览同宽的短陈旧窗口，
 * 换来「概览命中缓存时也不再打 4 条库」的收益。
 */
const PROFIT_DASHBOARD_HOME_CAPABILITY_CACHE_TTL_SECONDS = 30;

/** 首页能力快照：登录身份 + 门店业态共同决定的前端可用能力集合 */
export interface DashboardHomeCapabilitySnapshot {
  identityType: IdentityType;
  subAccountRole?: NonNullable<AuthenticatedMembership['subAccountRole']>;
  subAccountRoleLabel?: string;
  allowedHomeModules: ProfitHomeModule[];
  hiddenHomeModules: ProfitHomeModule[];
  canViewFinance: boolean;
  canViewMarketing: boolean;
  canUseGoodsManagement: boolean;
  subAccountStatus?: NonNullable<AuthenticatedMembership['subAccountStatus']>;
  subAccountAssigned?: boolean;
  canAccessHome?: boolean;
  canUseHandover?: boolean;
  canUseHandoverManagement: boolean;
  canUseSpaceManagement: boolean;
  canAccessStoreSettings: boolean;
  canAccessDashboardOverview: boolean;
  businessMode: 'catering' | 'general';
  isCateringStore: boolean;
  isGeneralStore: boolean;
  canUseScanOrdering: boolean;
  canManageScanOrderingMenu: boolean;
  canUseMarketingProductListing: boolean;
}

/** 门店业态；未知（门店不存在或查询失败）时由调用方降级处理 */
type StoreBusinessMode = 'catering' | 'general';

/**
 * 首页能力快照装配。
 *
 * 从 `DashboardHomeService` 抽出：该职责只依赖登录身份、子账号配额与门店业态，
 * 与概览的统计/趋势/动态聚合互不相关，独立后概览服务只保留数据编排。
 */
@Injectable()
export class DashboardHomeCapabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly subjectCapabilityService: SubjectCapabilityService,
    private readonly storeSubAccountService: StoreSubAccountService,
  ) {}

  /**
   * 读取能力快照（带短 TTL 缓存）。
   *
   * 此前每个请求都要跑 getStoreSubAccountSummary（会员档案 + 槽位两次查询）
   * 与 store.findUnique，即使概览命中 Redis 也照跑不误。首页是最高频端点，
   * 这里按 user + store 缓存，把命中路径的库查询降到 0。
   */
  async loadSnapshot(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<DashboardHomeCapabilitySnapshot> {
    // 尚未解析出具体门店（storeId = 0）时快照是纯内存推导：不去读缓存、
    // 也不写缓存，避免为「无门店」这个中间态制造一份注定过期的 Redis 键。
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return this.buildSnapshot(user, storeId);
    }

    const cacheKey = buildProfitDashboardHomeCapabilityCacheKey(
      user.id,
      storeId,
    );
    const cached =
      await this.redisService.getJson<DashboardHomeCapabilitySnapshot>(
        cacheKey,
      );
    if (cached) {
      return cached;
    }

    const snapshot = await this.buildSnapshot(user, storeId);
    await this.redisService.setJson(
      cacheKey,
      snapshot,
      PROFIT_DASHBOARD_HOME_CAPABILITY_CACHE_TTL_SECONDS,
    );
    return snapshot;
  }

  private async buildSnapshot(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<DashboardHomeCapabilitySnapshot> {
    // storeId 无效时三查（会员档案 + 子账号槽位 + 门店业态）必然查空，
    // 结果与「无档案」等价：quota = 0、业态未知。这里直接短路，
    // 省掉首页在多门店未选店瞬间的 3 条无效查询。
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return this.assembleSnapshot(user, 0, null);
    }

    // 子账号档案与门店业态互无依赖，并行下发而非串行等待
    const [subAccountSummary, businessMode] = await Promise.all([
      this.storeSubAccountService.getStoreSubAccountSummary(storeId),
      this.resolveStoreBusinessMode(storeId),
    ]);

    return this.assembleSnapshot(user, subAccountSummary.quota, businessMode);
  }

  private assembleSnapshot(
    user: AuthenticatedUser,
    subAccountQuota: number,
    businessMode: StoreBusinessMode | null,
  ): DashboardHomeCapabilitySnapshot {
    const snapshot = this.subjectCapabilityService.buildSnapshot(
      user.currentMembership,
      subAccountQuota,
    );

    const isCatering = businessMode === 'catering';
    const isBusinessModeKnown = businessMode !== null;

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
      canUseGoodsManagement: snapshot.canUseGoodsManagement,
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
      canUseSpaceManagement: isBusinessModeKnown
        ? snapshot.canUseSpaceManagement && !isCatering
        : false,
      canAccessStoreSettings: snapshot.canAccessStoreSettings,
      canAccessDashboardOverview:
        snapshot.allowedHomeModules.includes('additional') &&
        user.currentMembership?.canAccessHome !== false,
      // ─── 业态能力 ───
      businessMode: businessMode ?? 'general',
      isCateringStore: isCatering,
      isGeneralStore: isBusinessModeKnown && !isCatering,
      canUseScanOrdering: isCatering,
      canManageScanOrderingMenu: isCatering,
      canUseMarketingProductListing: isBusinessModeKnown && !isCatering,
    };
  }

  private async resolveStoreBusinessMode(
    storeId: number,
  ): Promise<StoreBusinessMode | null> {
    try {
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: { businessMode: true },
      });
      if (!store) {
        return null;
      }
      return store.businessMode;
    } catch {
      return null;
    }
  }
}
