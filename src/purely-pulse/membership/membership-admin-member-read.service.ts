import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.request.dto';
import type { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import type { PulseMemberListItemDto } from './dto/pulse-membership-admin-members.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import {
  buildPulseAdminMemberDetail,
  buildPulseAdminMemberListItem,
} from './membership-admin-member.builder';
import {
  buildAdminMemberListStoreWhere,
  type LegacyPulseAdminMembershipProfileRecord,
  type PulseAdminMembershipProfileListRecord,
  isMissingSubAccountQuotaSchemaError,
  matchesAdminMemberFilters,
} from './membership-admin-query.helper';
import type {
  PulseAdminMemberOrderSummary,
  PulseAdminMembershipOrderRecord,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminRenewalPriceAdjustRecord,
  PulseAdminStoreRecord,
  PulseAdminSubAccountQuotaAuditRecord,
  PulseAdminSubAccountDetail,
} from './membership.types';
import { PulseMembershipAdminSubAccountReadService } from './membership-admin-sub-account-read.service';
import { loadPlanCatalog } from '../../purely-profit/member/platform-membership/platform-membership.query';
import {
  StoreMembershipLockedPriceService,
  type LockedPriceSnapshot,
} from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';

type PulseAdminPaidOrderSummaryGroup = {
  storeId: number;
  _count: { _all: number };
  _sum: { amount: number | null };
  _max: { createdAt: Date | null };
};

type PulseAdminMemberListDependencies = {
  profileByStoreId: Map<number, PulseAdminMembershipProfileRecord>;
  orderSummaryByStoreId: Map<number, PulseAdminMemberOrderSummary>;
  partnerByStoreId: Map<number, PulseAdminPartnerRecord>;
  banReasons: Map<number, string>;
};

type PulseAdminMemberDetailSnapshot = {
  store: PulseAdminStoreRecord;
  profile: PulseAdminMembershipProfileRecord | null;
  paidOrders: PulseAdminMembershipOrderRecord[];
  partner: PulseAdminPartnerRecord | null;
  promoCount: number;
  subAccountSummary: PulseAdminSubAccountDetail;
  lockedPrices: LockedPriceSnapshot[];
  /** 调整续费价格审计（新→旧排序）：详情页「调整续费记录」tab 的数据源 */
  renewalPriceAdjustments: PulseAdminRenewalPriceAdjustRecord[];
  /** 子账号额度变更审计（新→旧排序）：详情页「子账号设置记录」tab 的数据源 */
  subAccountQuotaAudits: PulseAdminSubAccountQuotaAuditRecord[];
  /** 各档位当前配置价（分）：供 builder 折算「配置价 + 子账号加价 = 续费价」 */
  planPrices: Map<string, number>;
  banReason: string | null;
};

@Injectable()
export class PulseMembershipAdminMemberReadService {
  private readonly logger = new Logger(
    PulseMembershipAdminMemberReadService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly subAccountReadService: PulseMembershipAdminSubAccountReadService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
  ) {}

  async buildAdminMemberDetail(storeId: number): Promise<PulseMemberDetailDto> {
    const snapshot = await this.loadAdminMemberDetailSnapshot(storeId);

    return buildPulseAdminMemberDetail(snapshot);
  }

  async buildAdminMemberListItems(
    storeIds: number[],
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseMemberListItemDto[]> {
    if (storeIds.length === 0) {
      return [];
    }

    // 「待补录子账号加价」清单：有子账号能力但成交价快照里缺子账号加价的门店。
    // 这些门店的续费价会退化为 max(配置价, 成交总额)，配置价涨过成交总额即白送子账号，
    // 需要运营补录；过滤在进库查询前完成，避免拉全量再筛。
    //
    // 两个开关都是门店维度的清单筛选，同时打开时取交集（先补录、再已调价，逐级收窄）。
    let effectiveStoreIds = storeIds;

    // 收窄动作下沉到查询里（带上 storeId in (...)），不在内存里求交集
    if (query.pendingSubAccountBackfill === true) {
      effectiveStoreIds =
        await this.lockedPriceService.listStoresPendingSubAccountBackfill(
          effectiveStoreIds,
        );
    }

    // 「已调续费价」清单：续费价**被调整过**的门店（以审计为准，清空覆盖后仍算调过）。
    if (query.renewalPriceAdjusted === true) {
      effectiveStoreIds =
        await this.lockedPriceService.listStoresEverRenewalPriceAdjusted(
          effectiveStoreIds,
        );
    }

    if (effectiveStoreIds.length === 0) {
      return [];
    }

    const stores = await this.prisma.store.findMany({
      where: buildAdminMemberListStoreWhere(effectiveStoreIds, query),
      select: {
        id: true,
        name: true,
        contactPhone: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
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
      },
      orderBy: [{ id: 'asc' }],
    });
    if (stores.length === 0) {
      return [];
    }

    const dependencies = await this.loadAdminMemberListDependencies(
      stores.map((store) => store.id),
    );

    // 「已调价」徽章：口径与 renewalPriceAdjusted 筛选一致（审计为准 + 当前覆盖价兜底）
    const adjustedStoreIds = new Set(
      await this.lockedPriceService.listStoresEverRenewalPriceAdjusted(
        stores.map((store) => store.id),
      ),
    );

    return stores
      .map((store) =>
        buildPulseAdminMemberListItem({
          store,
          profile: dependencies.profileByStoreId.get(store.id) ?? null,
          orderSummary: dependencies.orderSummaryByStoreId.get(store.id),
          partner: dependencies.partnerByStoreId.get(store.id) ?? null,
          banReason: dependencies.banReasons.get(store.id) ?? null,
          renewalPriceAdjusted: adjustedStoreIds.has(store.id),
        }),
      )
      .filter((member) => matchesAdminMemberFilters(member, query));
  }

  async findMembershipProfileByStoreId(
    storeId: number,
  ): Promise<PulseAdminMembershipProfileRecord | null> {
    try {
      return await this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: {
          currentPlanId: true,
          previousPlanId: true,
          startsAt: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
          subAccountQuota: true,
          pulseSubAccountQuota: true,
        },
      });
    } catch (error: unknown) {
      if (!isMissingSubAccountQuotaSchemaError(error)) {
        throw error;
      }

      this.logger.warn(
        '[pulse-membership-admin] store_membership_profiles.sub_account_quota schema not ready, fallback to legacy profile query',
      );

      const profile = await this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: {
          currentPlanId: true,
          previousPlanId: true,
          startsAt: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      });

      return profile
        ? {
            ...profile,
            subAccountQuota: 0,
            pulseSubAccountQuota: null,
          }
        : null;
    }
  }

  private async loadAdminMemberDetailSnapshot(
    storeId: number,
  ): Promise<PulseAdminMemberDetailSnapshot> {
    const banReason = await this.accessService.getAdminMemberBanReason(storeId);
    const [
      store,
      profile,
      paidOrders,
      partner,
      promoCount,
      subAccountSummary,
      lockedPrices,
      planCatalog,
      renewalPriceAuditRows,
      subAccountQuotaAudits,
    ] = await Promise.all([
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: {
          id: true,
          name: true,
          contactPhone: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
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
        },
      }),
      this.findMembershipProfileByStoreId(storeId),
      this.loadPaidOrders(storeId),
      this.loadApprovedPartner(storeId),
      this.prisma.storeMembershipPromoRecord.count({
        where: { storeId },
      }),
      this.subAccountReadService.buildAdminSubAccountDetail(storeId),
      this.lockedPriceService.listLockedPrices(storeId),
      loadPlanCatalog(this.prisma),
      this.prisma.storeMembershipPriceOverrideAudit.findMany({
        where: { storeId },
        select: {
          id: true,
          planId: true,
          oldPrice: true,
          newPrice: true,
          operatorName: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.loadSubAccountQuotaAudits(storeId),
    ]);

    if (!store) {
      throw new NotFoundException('目标门店不存在');
    }

    // 档位展示名取自套餐目录：审计行只存 planId，
    // 目录里查不到（档位已下架）时回落成 planId，至少不丢这条痕
    const planNameById = new Map(
      planCatalog.map((plan) => [plan.id, plan.name]),
    );

    return {
      store,
      profile,
      planPrices: new Map(planCatalog.map((plan) => [plan.id, plan.price])),
      paidOrders,
      partner,
      promoCount,
      subAccountSummary,
      lockedPrices,
      renewalPriceAdjustments: renewalPriceAuditRows.map((row) => ({
        id: row.id,
        planId: row.planId,
        planName: planNameById.get(row.planId) ?? row.planId,
        oldPrice: row.oldPrice,
        newPrice: row.newPrice,
        operatorName: row.operatorName,
        createdAt: row.createdAt,
      })),
      subAccountQuotaAudits,
      banReason,
    };
  }

  /**
   * 子账号额度变更审计（新→旧）。
   *
   * 审计行只有 `operatorUserId`：用户改名后历史行会跟着变，但至少比显示一串 id 强；
   * 查不到用户（已注销 / 早期数据）时回落 null，前端按「平台操作」兜底展示。
   */
  private async loadSubAccountQuotaAudits(
    storeId: number,
  ): Promise<PulseAdminSubAccountQuotaAuditRecord[]> {
    const rows = await this.prisma.storeSubAccountQuotaAudit.findMany({
      where: { storeId },
      select: {
        id: true,
        oldQuota: true,
        newQuota: true,
        operatorUserId: true,
        reason: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const operatorIds = [
      ...new Set(
        rows
          .map((row) => row.operatorUserId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    // 空 id 集合不查库：既省一次往返，也避免 mock 环境下多打一枪
    const nameById =
      operatorIds.length === 0
        ? new Map<number, string>()
        : await this.loadOperatorNames(operatorIds);

    return rows.map((row) => ({
      id: row.id,
      oldQuota: row.oldQuota,
      newQuota: row.newQuota,
      operatorName:
        typeof row.operatorUserId === 'number'
          ? (nameById.get(row.operatorUserId) ?? null)
          : null,
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }

  /** 操作人展示名：realName → name 逐级回落，都没有则返回空 Map（前端兜底） */
  private async loadOperatorNames(userIds: number[]): Promise<Map<number, string>> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, realName: true },
    });

    const nameById = new Map<number, string>();
    for (const user of users) {
      const displayName = user.realName?.trim() || user.name?.trim();
      if (displayName) {
        nameById.set(user.id, displayName);
      }
    }

    return nameById;
  }

  /**
   * 会员订单（含后台设置记录）。
   *
   * 取出 `paymentChannel` 后交给 builder 按渠道拆成两组：
   * - wechat：商家端充值 → 「充值记录」
   * - admin / gift：管理端设置会员等级 → 「设置会员等级记录」（gift 显示「赠送」）
   */
  private async loadPaidOrders(
    storeId: number,
  ): Promise<PulseAdminMembershipOrderRecord[]> {
    return this.prisma.storeMembershipOrder.findMany({
      where: { storeId, status: 'paid' },
      select: {
        id: true,
        planId: true,
        planName: true,
        amount: true,
        paymentChannel: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async loadApprovedPartner(
    storeId: number,
  ): Promise<PulseAdminPartnerRecord | null> {
    return this.prisma.storePartner.findFirst({
      where: { storeId, deletedAt: null, status: 'approved' },
      select: {
        id: true,
        beanBalance: true,
        status: true,
        totalEarnedBeans: true,
        totalWithdrawnBeans: true,
      },
      orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async loadAdminMemberListDependencies(
    storeIds: number[],
  ): Promise<PulseAdminMemberListDependencies> {
    const [profiles, paidOrderSummaries, partners, banReasons] =
      await Promise.all([
        this.findMembershipProfilesByStoreIds(storeIds),
        this.prisma.storeMembershipOrder.groupBy({
          by: ['storeId'],
          where: {
            storeId: { in: storeIds },
            status: 'paid',
            // 只统计商家端真实充值：后台设置会员等级（admin / gift）单独成组展示，
            // 不能虚增列表的「充值次数 / 累计充值」
            paymentChannel: 'wechat',
          },
          _count: { _all: true },
          _sum: { amount: true },
          _max: { createdAt: true },
        }),
        this.prisma.storePartner.findMany({
          where: {
            storeId: { in: storeIds },
            deletedAt: null,
            status: 'approved',
          },
          select: {
            storeId: true,
            id: true,
            status: true,
            beanBalance: true,
            totalEarnedBeans: true,
            totalWithdrawnBeans: true,
          },
          orderBy: [
            { storeId: 'asc' },
            { reviewedAt: 'desc' },
            { joinedAt: 'desc' },
            { id: 'desc' },
          ],
        }),
        this.accessService.listAdminMemberBanReasons(storeIds),
      ]);

    return {
      profileByStoreId: new Map(
        profiles.map((profile) => [profile.storeId, profile]),
      ),
      orderSummaryByStoreId:
        this.buildOrderSummaryByStoreId(paidOrderSummaries),
      partnerByStoreId: this.buildPartnerByStoreId(partners),
      banReasons,
    };
  }

  private buildOrderSummaryByStoreId(
    paidOrderSummaries: PulseAdminPaidOrderSummaryGroup[],
  ): Map<number, PulseAdminMemberOrderSummary> {
    return new Map(
      paidOrderSummaries.map((summary) => [
        summary.storeId,
        {
          rechargeCount: summary._count._all,
          totalRecharged: Money.fromDbCents(
            summary._sum.amount ?? 0,
          ).toDbCents(),
          lastPaidAt: summary._max.createdAt?.getTime() ?? null,
        },
      ]),
    );
  }

  private buildPartnerByStoreId(
    partners: Array<PulseAdminPartnerRecord & { storeId: number }>,
  ): Map<number, PulseAdminPartnerRecord> {
    const partnerByStoreId = new Map<number, PulseAdminPartnerRecord>();
    for (const partner of partners) {
      if (!partnerByStoreId.has(partner.storeId)) {
        partnerByStoreId.set(partner.storeId, {
          id: partner.id,
          status: partner.status,
          beanBalance: partner.beanBalance,
          totalEarnedBeans: partner.totalEarnedBeans,
          totalWithdrawnBeans: partner.totalWithdrawnBeans,
        });
      }
    }

    return partnerByStoreId;
  }

  private async findMembershipProfilesByStoreIds(
    storeIds: number[],
  ): Promise<PulseAdminMembershipProfileListRecord[]> {
    try {
      return await this.prisma.storeMembershipProfile.findMany({
        where: { storeId: { in: storeIds } },
        select: {
          storeId: true,
          currentPlanId: true,
          previousPlanId: true,
          startsAt: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
          subAccountQuota: true,
          pulseSubAccountQuota: true,
        },
      });
    } catch (error: unknown) {
      if (!isMissingSubAccountQuotaSchemaError(error)) {
        throw error;
      }

      this.logger.warn(
        '[pulse-membership-admin] store_membership_profiles.sub_account_quota schema not ready, fallback to legacy profile list query',
      );

      const profiles = await this.prisma.storeMembershipProfile.findMany({
        where: { storeId: { in: storeIds } },
        select: {
          storeId: true,
          currentPlanId: true,
          previousPlanId: true,
          startsAt: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      });

      return profiles.map(
        (profile): PulseAdminMembershipProfileListRecord => ({
          ...(profile as LegacyPulseAdminMembershipProfileRecord & {
            storeId: number;
          }),
          subAccountQuota: 0,
          pulseSubAccountQuota: null,
        }),
      );
    }
  }
}
