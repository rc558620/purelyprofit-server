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
import type { AdjustPulseAdminNewCustomerQuotaDto } from './dto/pulse-membership-admin-new-customer-quota.request.dto';
import type {
  PulseAdminNewCustomerQuotaStoreDto,
  PulseAdminNewCustomerQuotaStoresResponseDto,
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

  /** 可访问门店的新客额度一览（展示主账号身份 + 额度现状） */
  async listAdminQuotaStores(
    user: AuthenticatedUser,
  ): Promise<PulseAdminNewCustomerQuotaStoresResponseDto> {
    const storeIds = await this.resolveVisibleStoreIds(user);
    if (storeIds.length === 0) {
      return { items: [] };
    }

    const stores = await this.prisma.store.findMany({
      where: { id: { in: storeIds }, deletedAt: null },
      select: QUOTA_STORE_SELECT,
      orderBy: { id: 'asc' },
    });

    return {
      items: stores.map((store) => this.buildQuotaStoreDto(store)),
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
}
