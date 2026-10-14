import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { loadPlanCatalog } from '../../purely-profit/member/platform-membership/platform-membership.query';
import { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.query.request.dto';
import type { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import type { PulseMemberListItemDto } from './dto/pulse-membership-admin-members.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import {
  buildAdminMemberDetailSnapshot,
  buildAdminMemberListDependencies,
} from './membership-admin-member-read.builder';
import {
  countAdminPromoRecords,
  fetchAdminApprovedPartner,
  fetchAdminApprovedPartners,
  fetchAdminMemberListStores,
  fetchAdminMemberStore,
  fetchAdminMembershipProfile,
  fetchAdminMembershipProfiles,
  fetchAdminPaidOrders,
  fetchAdminRenewalPriceAuditRows,
  fetchAdminSubAccountQuotaAudits,
  groupAdminPaidOrderSummaries,
} from './membership-admin-member-read.query';
import type {
  PulseAdminMemberDetailSnapshot,
  PulseAdminMemberListDependencies,
} from './membership-admin-member-read.types';
import {
  buildPulseAdminMemberDetail,
  buildPulseAdminMemberListItem,
} from './membership-admin-member.builder';
import { matchesAdminMemberFilters } from './membership-admin-query.helper';
import { PulseMembershipAdminSubAccountReadService } from './membership-admin-sub-account-read.service';
import type { PulseAdminMembershipProfileRecord } from './membership.types';

/**
 * 会员读服务：只做编排（清单收敛 → 并发取数 → 装配 → 映射成 DTO）。
 *
 * 取数见 `membership-admin-member-read.query`，
 * 行 → 装配结构的折算见 `membership-admin-member-read.builder`，
 * 装配结构 → DTO 的展示口径见 `membership-admin-member.builder`。
 */
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

    const stores = await fetchAdminMemberListStores(
      this.prisma,
      effectiveStoreIds,
      query,
    );
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
    return fetchAdminMembershipProfile(this.prisma, storeId, (message) =>
      this.logger.warn(message),
    );
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
      fetchAdminMemberStore(this.prisma, storeId),
      this.findMembershipProfileByStoreId(storeId),
      fetchAdminPaidOrders(this.prisma, storeId),
      fetchAdminApprovedPartner(this.prisma, storeId),
      countAdminPromoRecords(this.prisma, storeId),
      this.subAccountReadService.buildAdminSubAccountDetail(storeId),
      this.lockedPriceService.listLockedPrices(storeId),
      loadPlanCatalog(this.prisma),
      fetchAdminRenewalPriceAuditRows(this.prisma, storeId),
      fetchAdminSubAccountQuotaAudits(this.prisma, storeId),
    ]);

    if (!store) {
      throw new NotFoundException('目标门店不存在');
    }

    return buildAdminMemberDetailSnapshot({
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
      banReason,
    });
  }

  private async loadAdminMemberListDependencies(
    storeIds: number[],
  ): Promise<PulseAdminMemberListDependencies> {
    const [profiles, paidOrderSummaries, partners, banReasons] =
      await Promise.all([
        fetchAdminMembershipProfiles(this.prisma, storeIds, (message) =>
          this.logger.warn(message),
        ),
        groupAdminPaidOrderSummaries(this.prisma, storeIds),
        fetchAdminApprovedPartners(this.prisma, storeIds),
        this.accessService.listAdminMemberBanReasons(storeIds),
      ]);

    return buildAdminMemberListDependencies({
      profiles,
      paidOrderSummaries,
      partners,
      banReasons,
    });
  }
}
