// Pulse / 新客额度管理服务
//
// 供 purelyPulse「新客额度」页面使用：跨可访问门店聚合额度现状，
// 并允许平台运营为单个门店增减额度。
//
// 数据口径与 purelyProfit `/marketing/new-customer-quota` 完全一致：
// 余额本体是 `store_membership_profiles.new_customer_quota`，
// 流水来自 `store_new_customer_quota_logs`，因此运营在 Pulse 侧调整后，
// 商家端额度页与 purelyClub 的新客下单闸门会立刻按同一份数据生效。
import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD } from '../../purely-profit/member/new-customer-quota/new-customer-quota.constants';
import { NewCustomerQuotaService } from '../../purely-profit/member/new-customer-quota/new-customer-quota.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AdjustPulseAdminNewCustomerQuotaDto,
  GetPulseAdminNewCustomerQuotaStoresQueryDto,
} from './dto/pulse-membership-admin-new-customer-quota.request.dto';
import {
  PULSE_ADMIN_QUOTA_STORES_DEFAULT_PAGE_SIZE,
  PULSE_ADMIN_QUOTA_STORES_MAX_PAGE_SIZE,
} from './dto/pulse-membership-admin-new-customer-quota.request.dto';
import type {
  PulseAdminNewCustomerQuotaStoreDto,
  PulseAdminNewCustomerQuotaStoresResponseDto,
  PulseAdminNewCustomerQuotaStoresStatsDto,
} from './dto/pulse-membership-admin-new-customer-quota.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import {
  resolveAdminMemberDisplayName,
  resolveAdminMemberPhone,
} from './membership-admin-query.helper';
import type { PulseAdminStoreIdentityRecord } from './membership.types';

/** 额度列表行所需的最小门店记录：主账号身份 + 额度档案 */
interface PulseQuotaStoreRecord extends PulseAdminStoreIdentityRecord {
  id: number;
  membershipProfile: {
    newCustomerQuota: number;
    newCustomerQuotaConsumed: number;
    updatedAt: Date;
  } | null;
}

/** 门店 + 主账号身份的查询字段（与会员列表口径保持一致） */
const QUOTA_STORE_SELECT = {
  id: true,
  name: true,
  contactPhone: true,
  owner: {
    select: {
      email: true,
      name: true,
      realName: true,
      avatar: true,
      wechatPhone: true,
      lastActiveAt: true,
    },
  },
  membershipProfile: {
    select: {
      newCustomerQuota: true,
      newCustomerQuotaConsumed: true,
      updatedAt: true,
    },
  },
} as const;

@Injectable()
export class PulseMembershipAdminNewCustomerQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly quotaService: NewCustomerQuotaService,
  ) {}

  /**
   * 可访问门店的新客额度一览（搜索 / 健康度筛选 / 分页）。
   *
   * 与会员列表接口同一口径：先按 keyword / health 过滤，再切出当前页。
   * 额度可见门店量级为商家门店数，内存过滤成本可接受，
   * 且 keyword 匹配行为与前端原实现（toLowerCase().includes）完全一致。
   *
   * 统计口径不同于分页切片：**只吃 keyword 过滤、忽略 health 筛选**。
   * 顶部「门店数 / 额度合计」是概览指标，若跟随「已耗尽」Tab 会恒为 0 而失去意义。
   */
  async listAdminQuotaStores(
    user: AuthenticatedUser,
    query: GetPulseAdminNewCustomerQuotaStoresQueryDto,
  ): Promise<PulseAdminNewCustomerQuotaStoresResponseDto> {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? PULSE_ADMIN_QUOTA_STORES_DEFAULT_PAGE_SIZE,
      PULSE_ADMIN_QUOTA_STORES_MAX_PAGE_SIZE,
    );

    const storeIds = await this.resolveVisibleStoreIds(user);
    if (storeIds.length === 0) {
      return this.buildEmptyPageResult(page, pageSize);
    }

    const stores = await this.prisma.store.findMany({
      where: { id: { in: storeIds }, deletedAt: null },
      select: QUOTA_STORE_SELECT,
      orderBy: { id: 'asc' },
    });

    const keywordMatchedStores = stores.filter((store) =>
      matchesQuotaKeyword(store, query.keyword),
    );
    const filteredStores = query.health
      ? keywordMatchedStores.filter((store) =>
          matchesQuotaHealth(store.membershipProfile, query.health),
        )
      : keywordMatchedStores;

    return {
      items: filteredStores
        .slice((page - 1) * pageSize, page * pageSize)
        .map((store) => this.buildQuotaStoreDto(store)),
      total: filteredStores.length,
      page,
      pageSize,
      hasMore: page * pageSize < filteredStores.length,
      // 统计只吃 keyword 过滤：概览指标不随「已耗尽」等 Tab 抖动
      stats: buildQuotaStoresStats(keywordMatchedStores),
    };
  }

  /**
   * 增减门店新客额度（增量语义，余额不会低于 0）。
   *
   * 权限口径沿用 `assertAdminMemberMutationAccess`：仅开发者，且目标门店不在
   * `pulse.devAccountEmails` 排除名单内（即平台运营改商家、改不到自己的测试店），
   * 与 Pulse 会员管理其它写操作完全一致。
   * 商家自身的付费充值仍然走 purelyProfit 的微信支付链路。
   */
  async adjustAdminQuota(
    user: AuthenticatedUser,
    storeId: number,
    dto: AdjustPulseAdminNewCustomerQuotaDto,
  ): Promise<PulseAdminNewCustomerQuotaStoreDto> {
    await this.accessService.assertAdminMemberMutationAccess(user, storeId);

    const store = await this.loadQuotaStoreOrThrow(storeId);
    const reason = dto.reason?.trim();
    const remaining = await this.quotaService.adjustQuota(
      storeId,
      dto.delta,
      reason ? `平台运营调整新客额度：${reason}` : '平台运营调整新客额度',
    );

    return this.buildQuotaStoreDto(store, {
      remaining,
      updatedAt: new Date(),
    });
  }

  /**
   * 额度管理可见门店。
   *
   * 开发者（平台运营）：直接按「未注销 + 非排除名单」列出全部商家门店，
   * **不要求已经有会员档案**——`resolveAdminMemberStoreIds` 走的是
   * `storeMembershipProfile` 查询，从未打开过会员中心的商家没有档案行会被漏掉，
   * 导致运营在 Pulse 里看不到这家店、也就没法给它发额度。
   * 额度是「平台给商家发放的资源」，可见范围应当等于全部可运营商家。
   *
   * 非开发者：仍退回 `resolveAdminMemberStoreIds`，只给自己的门店。
   */
  private async resolveVisibleStoreIds(
    user: AuthenticatedUser,
  ): Promise<number[]> {
    if (!this.accessService.isDeveloper(user)) {
      return this.accessService.resolveAdminMemberStoreIds(user);
    }

    const stores = await this.prisma.store.findMany({
      where: {
        ...this.accessService.buildAdminStoreExclusionWhere(),
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    return stores.map((store) => store.id);
  }

  /**
   * 读取目标门店；已注销（软删）门店按「不存在」处理。
   *
   * 列表已经过滤掉 deletedAt 非 null 的门店，这里必须同口径，
   * 否则直接调接口仍能给已注销门店改额度。
   */
  private async loadQuotaStoreOrThrow(
    storeId: number,
  ): Promise<PulseQuotaStoreRecord> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: QUOTA_STORE_SELECT,
    });
    if (!store) {
      throw new NotFoundException('会员不存在');
    }

    return store;
  }

  private buildQuotaStoreDto(
    store: PulseQuotaStoreRecord,
    overrides?: { remaining: number; updatedAt: Date },
  ): PulseAdminNewCustomerQuotaStoreDto {
    const profile = store.membershipProfile;

    return {
      storeId: String(store.id),
      storeName: store.name,
      ownerName: resolveAdminMemberDisplayName(store),
      ownerPhone: resolveAdminMemberPhone(store),
      ownerAvatarUrl: store.owner.avatar ?? '',
      remaining: overrides?.remaining ?? profile?.newCustomerQuota ?? 0,
      consumed: profile?.newCustomerQuotaConsumed ?? 0,
      warningThreshold: NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
      updatedAt:
        (overrides?.updatedAt ?? profile?.updatedAt)?.getTime() ?? null,
    };
  }

  /** 无可访问门店时的空分页结果（统计归零，结构与正常分页一致） */
  private buildEmptyPageResult(
    page: number,
    pageSize: number,
  ): PulseAdminNewCustomerQuotaStoresResponseDto {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      hasMore: false,
      stats: {
        storeCount: 0,
        totalRemaining: 0,
        warningCount: 0,
        exhaustedCount: 0,
      },
    };
  }
}

/** 额度健康度判定：口径与前端 resolveQuotaHealth 完全一致 */
function resolveProfileHealth(
  profile: PulseQuotaStoreRecord['membershipProfile'],
): 'none' | 'exhausted' | 'warning' | 'healthy' {
  const remaining = profile?.newCustomerQuota ?? 0;
  if (remaining <= 0) {
    return (profile?.newCustomerQuotaConsumed ?? 0) > 0 ? 'exhausted' : 'none';
  }

  return remaining < NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD
    ? 'warning'
    : 'healthy';
}

/** keyword 匹配：主账号昵称 / 手机号 / 门店名（大小写不敏感） */
function matchesQuotaKeyword(
  store: PulseQuotaStoreRecord,
  rawKeyword: string | undefined,
): boolean {
  const keyword = rawKeyword?.trim().toLowerCase();
  if (!keyword) {
    return true;
  }

  return (
    store.name.toLowerCase().includes(keyword) ||
    (store.contactPhone ?? '').toLowerCase().includes(keyword) ||
    resolveAdminMemberDisplayName(store).toLowerCase().includes(keyword) ||
    resolveAdminMemberPhone(store).toLowerCase().includes(keyword)
  );
}

/** health 筛选：warning / exhausted，不传为全部 */
function matchesQuotaHealth(
  profile: PulseQuotaStoreRecord['membershipProfile'],
  health: 'warning' | 'exhausted' | undefined,
): boolean {
  if (!health) {
    return true;
  }

  return resolveProfileHealth(profile) === health;
}

/**
 * 基于 keyword 过滤后的完整门店集合构建统计概览。
 *
 * 统计必须吃**分页切片之前**的全量结果，否则「门店数 / 额度合计」会跟着页大小缩水；
 * 且不吃 health 筛选，否则切到「已耗尽」Tab 时概览会恒为 0。
 * 未发放（remaining=0 且 consumed=0）不计入已耗尽，与前端口径一致。
 */
function buildQuotaStoresStats(
  stores: PulseQuotaStoreRecord[],
): PulseAdminNewCustomerQuotaStoresStatsDto {
  let totalRemaining = 0;
  let warningCount = 0;
  let exhaustedCount = 0;

  for (const store of stores) {
    totalRemaining += store.membershipProfile?.newCustomerQuota ?? 0;

    const health = resolveProfileHealth(store.membershipProfile);
    if (health === 'exhausted') {
      exhaustedCount += 1;
    } else if (health === 'warning') {
      warningCount += 1;
    }
  }

  return {
    storeCount: stores.length,
    totalRemaining,
    warningCount,
    exhaustedCount,
  };
}
