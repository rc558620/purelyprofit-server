import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PartnerWithdrawalStatus, Prisma, StaffRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type {
  ApplyPlatformPartnerDto,
  PlatformMembershipPlanId,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type {
  PlatformMembershipPartnerProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import type { ApplyWithdrawalResponseDto } from '../../purely-profit/member/withdrawals/dto/withdrawal-response.dto';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import type {
  GetPulseAdminPartnerApplicationsQueryDto,
  GetPulseAdminPayoutsQueryDto,
  PulseAdminPartnerApplicationsResponseDto,
  PulseAdminApprovePartnerApplicationDto,
  PulseAdminApprovePayoutDto,
  PulseAdminPayoutsResponseDto,
  PulseAdminRejectPartnerApplicationDto,
  PulseAdminRejectPayoutDto,
  PulseEarningsLogItemDto,
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
  PulsePartnerApplicationStatusValue,
  PulseWithdrawalAccountResponseDto,
  UpdatePulseWithdrawalAccountDto,
} from './dto/pulse-growth.dto';
import type { PulseEarningsLogTypeValue } from './dto/pulse-growth.dto';

type BeanTypeValue = 'earn' | 'spend' | 'withdraw';
type BeanSourceValue =
  | 'promo_reward'
  | 'deduct_payment'
  | 'withdrawal'
  | 'admin_adjust';

type AdminPayoutStatus = 'pending' | 'paid' | 'rejected';

interface PartnerBeanLogRecord {
  id: number;
  source: BeanSourceValue;
  changeAmount: number;
  description: string;
  relatedPromoRecordId: number | null;
  relatedUser: string | null;
  relatedPlanType: PlatformMembershipPlanId | null;
  createdAt: Date;
}

interface AdminPromoPeriodRecord {
  label: string;
  orders: number;
  revenue: number;
}

interface AdminPromoPartnerItem {
  id: string;
  name: string;
  province: string;
  city: string;
  district?: string;
  orders: number;
  revenue: number;
  growth: number;
  avatar: string;
  rank: number;
  joinDate: string;
  phone: string;
  series: {
    day: AdminPromoPeriodRecord[];
    month: AdminPromoPeriodRecord[];
    year: AdminPromoPeriodRecord[];
  };
}

interface AdminPromoRegionItem {
  province: string;
  city?: string;
  partnerCount: number;
  totalOrders: number;
  totalRevenue: number;
  growth: number;
}

export interface PulseAdminPromoDetailResponse {
  regions: AdminPromoRegionItem[];
  partners: AdminPromoPartnerItem[];
}

interface PromoDateRange {
  startAt: Date | null;
  endAt: Date | null;
}

interface PromoMetricRecord {
  recordAt: Date;
  chargedAmount: number;
}

@Injectable()
export class PulseGrowthService {
  private readonly pulseDevAccountEmails: Set<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly pulseStoreContextService: PulseStoreContextService,
    configService: ConfigService,
  ) {
    this.pulseDevAccountEmails = new Set(
      (configService.get<string[]>('pulse.devAccountEmails') ?? []).map((email) =>
        email.trim().toLowerCase(),
      ),
    );
  }

  async getPromoCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    const store = await this.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看增长中心',
    });
    return this.platformMembershipService.getPromoCenterByStoreId(store.id);
  }

  async getAdminPromoDetail(
    user: AuthenticatedUser,
    rawQuery: Record<string, unknown>,
  ): Promise<PulseAdminPromoDetailResponse> {
    const storeWhere = await this.buildAdminStoreWhere(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看推广详情',
    });
    const dateRange = this.resolvePromoDateRange(rawQuery);

    const partners = await this.prisma.storePartner.findMany({
      where: {
        status: 'approved',
        store: storeWhere,
      },
      select: {
        storeId: true,
        name: true,
        phone: true,
        region: true,
        joinedAt: true,
        store: {
          select: {
            name: true,
            owner: {
              select: {
                name: true,
              },
            },
            membershipPromoRecords: {
              where: { hasCharged: true },
              select: {
                chargedAmount: true,
                chargedAt: true,
                registeredAt: true,
              },
              orderBy: [{ chargedAt: 'asc' }, { registeredAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
      orderBy: [{ joinedAt: 'desc' }, { storeId: 'asc' }],
    });

    const partnerItems = partners
      .map((partner) => this.mapAdminPromoPartner(partner, dateRange))
      .sort((left, right) => {
        if (right.revenue !== left.revenue) {
          return right.revenue - left.revenue;
        }
        return right.orders - left.orders;
      })
      .map((partner, index) => ({
        ...partner,
        rank: index + 1,
      }));

    const regionMap = new Map<string, AdminPromoRegionItem>();
    partnerItems.forEach((partner) => {
      const province = partner.province || partner.city || '未知地区';
      const existing = regionMap.get(province);
      if (existing) {
        existing.partnerCount += 1;
        existing.totalOrders += partner.orders;
        existing.totalRevenue += partner.revenue;
        existing.growth = Math.max(existing.growth, partner.growth);
        return;
      }

      regionMap.set(province, {
        province,
        city: undefined,
        partnerCount: 1,
        totalOrders: partner.orders,
        totalRevenue: partner.revenue,
        growth: partner.growth,
      });
    });

    const regions = [...regionMap.values()].sort((left, right) => {
      if (right.partnerCount !== left.partnerCount) {
        return right.partnerCount - left.partnerCount;
      }
      return right.totalRevenue - left.totalRevenue;
    });

    return {
      regions,
      partners: partnerItems,
    };
  }

  async getPartnerProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    const store = await this.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看合伙人档案',
    });
    return this.platformMembershipService.getPartnerProfileByStoreId(store.id);
  }

  async listAdminPartnerApplications(
    user: AuthenticatedUser,
    query: GetPulseAdminPartnerApplicationsQueryDto,
  ): Promise<PulseAdminPartnerApplicationsResponseDto> {
    const where = await this.buildPartnerApplicationWhere(user);
    const applications = await this.prisma.storePartnerApplication.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        region: true,
        applyReason: true,
        createdAt: true,
        status: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const items = applications.map((application) => this.mapAdminPartnerApplication(application));
    const filteredItems = this.filterAdminPartnerApplications(items, query.tab);

    return {
      items: filteredItems,
      pendingCount: items.filter((item) => item.status === 'pending').length,
      approvedCount: items.filter((item) => item.status === 'approved').length,
      rejectedCount: items.filter((item) => item.status === 'rejected').length,
    };
  }

  async approveAdminPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
    dto: PulseAdminApprovePartnerApplicationDto,
  ): Promise<{ success: true }> {
    const application = await this.prisma.storePartnerApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, storeId: true },
    });

    if (!application) {
      throw new NotFoundException('合伙人申请不存在');
    }

    await this.assertCanAccessAdminStore(user, application.storeId, '合伙人申请不存在');
    const scopedUser = this.buildScopedUser(user, application.storeId);

    await this.platformMembershipService.approvePartnerApplication(
      scopedUser,
      applicationId,
    );

    const note = dto.note?.trim();
    if (note) {
      await this.platformMembershipService.addPartnerFollowUpNote(scopedUser, applicationId, {
        content: note,
      });
    }

    return { success: true };
  }

  async rejectAdminPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
    dto: PulseAdminRejectPartnerApplicationDto,
  ): Promise<{ success: true }> {
    const application = await this.prisma.storePartnerApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, storeId: true },
    });

    if (!application) {
      throw new NotFoundException('合伙人申请不存在');
    }

    await this.assertCanAccessAdminStore(user, application.storeId, '合伙人申请不存在');

    await this.platformMembershipService.rejectPartnerApplication(
      this.buildScopedUser(user, application.storeId),
      applicationId,
      { reason: dto.reason },
    );

    return { success: true };
  }

  async applyPartner(
    user: AuthenticatedUser,
    _dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    await this.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法发起合伙人申请',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家提交合伙人申请',
    );
  }

  async cancelPartnerApplication(
    user: AuthenticatedUser,
    _applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    await this.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法操作合伙人申请',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家撤销合伙人申请',
    );
  }

  async getEarningsOverview(
    user: AuthenticatedUser,
  ): Promise<PulseEarningsOverviewResponseDto> {
    const store = await this.resolveTargetStoreForGrowth(user);

    const [partner, promoRecords, pendingWithdrawals] = await Promise.all([
      this.prisma.storePartner.findUnique({
        where: { storeId: store.id },
        select: {
          status: true,
          beanBalance: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
      }),
      this.prisma.storeMembershipPromoRecord.findMany({
        where: { storeId: store.id },
        select: { hasCharged: true },
      }),
      this.prisma.partnerWithdrawal.count({
        where: {
          storeId: store.id,
          status: {
            in: [
              PartnerWithdrawalStatus.pending,
              PartnerWithdrawalStatus.approved,
            ],
          },
        },
      }),
    ]);

    const isPartner = partner?.status === 'approved';
    const chargedPromos = promoRecords.filter((record) => record.hasCharged).length;

    return {
      beanBalance: isPartner ? (partner?.beanBalance ?? 0) : 0,
      totalEarnedBeans: isPartner ? (partner?.totalEarnedBeans ?? 0) : 0,
      totalWithdrawnBeans: isPartner ? (partner?.totalWithdrawnBeans ?? 0) : 0,
      totalPromos: promoRecords.length,
      chargedPromos,
      isPartner,
      pendingWithdrawals,
    };
  }

  async getEarningsLogs(
    user: AuthenticatedUser,
    typeFilter: PulseEarningsLogTypeValue = 'all',
  ): Promise<PulseEarningsLogsResponseDto> {
    const store = await this.resolveTargetStoreForGrowth(user);

    const partner = await this.prisma.storePartner.findUnique({
      where: { storeId: store.id },
      select: { id: true, status: true, beanBalance: true },
    });

    if (!partner || partner.status !== 'approved') {
      return { items: [], beanBalance: 0 };
    }

    const rawLogs = await this.prisma.storePartnerBeanLog.findMany({
      where: { storeId: store.id, partnerId: partner.id },
      select: {
        id: true,
        source: true,
        changeAmount: true,
        description: true,
        relatedPromoRecordId: true,
        relatedUser: true,
        relatedPlanType: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const logs = rawLogs as PartnerBeanLogRecord[];
    const filteredLogs = this.filterLogsByType(logs, typeFilter);

    return {
      items: filteredLogs.map((log) => this.mapBeanLog(log, store.ownerName)),
      beanBalance: partner.beanBalance,
    };
  }

  async listAdminPayouts(
    user: AuthenticatedUser,
    query: GetPulseAdminPayoutsQueryDto,
  ): Promise<PulseAdminPayoutsResponseDto> {
    const where = await this.buildAdminPayoutWhere(user);
    const withdrawals = await this.prisma.partnerWithdrawal.findMany({
      where,
      select: {
        id: true,
        beanAmount: true,
        rmbAmount: true,
        accountType: true,
        accountNo: true,
        accountName: true,
        status: true,
        appliedAt: true,
        paidAt: true,
        rejectReason: true,
        partner: {
          select: {
            name: true,
            phone: true,
            region: true,
          },
        },
      },
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
    });

    const items = withdrawals.map((withdrawal) => this.mapAdminPayoutItem(withdrawal));
    const filteredItems = this.filterAdminPayouts(items, query.tab);
    const pendingItems = items.filter((item) => item.status === 'pending');
    const paidItems = items.filter((item) => item.status === 'paid');

    return {
      items: filteredItems,
      pendingCount: pendingItems.length,
      pendingTotal: pendingItems.reduce((sum, item) => sum + item.amount, 0),
      paidTotal: paidItems.reduce((sum, item) => sum + item.amount, 0),
    };
  }

  async approveAdminPayout(
    user: AuthenticatedUser,
    payoutId: number,
    _dto: PulseAdminApprovePayoutDto,
  ): Promise<{ success: true }> {
    const record = await this.prisma.partnerWithdrawal.findUnique({
      where: { id: payoutId },
      select: {
        id: true,
        storeId: true,
        status: true,
      },
    });

    if (!record) {
      throw new NotFoundException('打款申请不存在');
    }

    await this.assertCanAccessAdminStore(user, record.storeId, '打款申请不存在');

    if (
      record.status !== PartnerWithdrawalStatus.pending &&
      record.status !== PartnerWithdrawalStatus.approved
    ) {
      throw new ConflictException('当前打款申请状态不可执行确认打款');
    }

    const now = new Date();
    const updateResult = await this.prisma.partnerWithdrawal.updateMany({
      where: {
        id: payoutId,
        storeId: record.storeId,
        status: { in: [PartnerWithdrawalStatus.pending, PartnerWithdrawalStatus.approved] },
      },
      data: {
        status: PartnerWithdrawalStatus.paid,
        reviewedAt: now,
        paidAt: now,
        rejectReason: null,
      },
    });

    if (updateResult.count !== 1) {
      throw new ConflictException('打款申请状态已变化，请刷新后重试');
    }

    return { success: true };
  }

  async rejectAdminPayout(
    user: AuthenticatedUser,
    payoutId: number,
    dto: PulseAdminRejectPayoutDto,
  ): Promise<{ success: true }> {
    const record = await this.prisma.partnerWithdrawal.findUnique({
      where: { id: payoutId },
      select: {
        id: true,
        storeId: true,
        partnerId: true,
        beanAmount: true,
        status: true,
      },
    });

    if (!record) {
      throw new NotFoundException('打款申请不存在');
    }

    await this.assertCanAccessAdminStore(user, record.storeId, '打款申请不存在');

    if (
      record.status !== PartnerWithdrawalStatus.pending &&
      record.status !== PartnerWithdrawalStatus.approved
    ) {
      throw new ConflictException('当前打款申请状态不可执行拒绝操作');
    }

    const rejectReason = dto.rejectReason.trim();
    if (!rejectReason) {
      throw new ConflictException('拒绝原因不能为空');
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updateResult = await tx.partnerWithdrawal.updateMany({
        where: {
          id: payoutId,
          storeId: record.storeId,
          status: { in: [PartnerWithdrawalStatus.pending, PartnerWithdrawalStatus.approved] },
        },
        data: {
          status: PartnerWithdrawalStatus.rejected,
          reviewedAt: now,
          paidAt: null,
          rejectReason,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('打款申请状态已变化，请刷新后重试');
      }

      const partnerUpdateResult = await tx.storePartner.updateMany({
        where: {
          id: record.partnerId,
          storeId: record.storeId,
          totalWithdrawnBeans: { gte: record.beanAmount },
        },
        data: {
          beanBalance: { increment: record.beanAmount },
          totalWithdrawnBeans: { decrement: record.beanAmount },
        },
      });

      if (partnerUpdateResult.count !== 1) {
        throw new ConflictException('合伙人余额更新失败，请稍后重试');
      }

      await tx.storePartnerBeanLog.create({
        data: {
          storeId: record.storeId,
          partnerId: record.partnerId,
          source: 'admin_adjust',
          changeAmount: record.beanAmount,
          description: `打款驳回退回 · ${record.beanAmount} 豆已退回`,
        },
      });
    });

    return { success: true };
  }

  async getWithdrawalAccount(
    user: AuthenticatedUser,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    const store = await this.resolveTargetStoreForGrowth(user);

    const partner = await this.prisma.storePartner.findUnique({
      where: { storeId: store.id },
      select: {
        status: true,
        beanBalance: true,
        paymentAccountType: true,
        paymentAccountNo: true,
        paymentAccountName: true,
      },
    });

    const isPartner = partner?.status === 'approved';

    if (!isPartner) {
      return {
        isPartner: false,
        accountType: null,
        accountNo: null,
        accountName: null,
        beanBalance: 0,
      };
    }

    return {
      isPartner: true,
      accountType:
        (partner?.paymentAccountType as 'wechat' | 'alipay' | 'bank' | null) ??
        null,
      accountNo: partner?.paymentAccountNo ?? null,
      accountName: partner?.paymentAccountName ?? null,
      beanBalance: partner?.beanBalance ?? 0,
    };
  }

  async updateWithdrawalAccount(
    user: AuthenticatedUser,
    _dto: UpdatePulseWithdrawalAccountDto,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    await this.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法操作提现账户',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家修改提现账户',
    );
  }

  async applyWithdrawal(
    user: AuthenticatedUser,
    _beanAmount: number,
  ): Promise<ApplyWithdrawalResponseDto> {
    await this.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法发起提现申请',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家发起提现申请',
    );
  }

  private async buildPartnerApplicationWhere(
    user: AuthenticatedUser,
  ): Promise<Prisma.StorePartnerApplicationWhereInput> {
    if (this.isDeveloper(user)) {
      return {
        store: this.buildAdminStoreExclusionWhere(),
      };
    }

    return {
      storeId: await this.resolveObservedStoreId(user, '当前未选中目标商家门店，暂无法查看合伙人申请'),
    };
  }

  private async buildAdminPayoutWhere(
    user: AuthenticatedUser,
  ): Promise<Prisma.PartnerWithdrawalWhereInput> {
    if (this.isDeveloper(user)) {
      return {
        store: this.buildAdminStoreExclusionWhere(),
      };
    }

    return {
      storeId: await this.resolveObservedStoreId(user, '当前未选中目标商家门店，暂无法查看打款管理'),
    };
  }

  private async resolveObservedStoreId(
    user: AuthenticatedUser,
    notFoundMessage: string,
  ): Promise<number> {
    if (user.currentMembership?.storeId) {
      return user.currentMembership.storeId;
    }

    const store = await this.resolveTargetStoreForGrowth(user, { notFoundMessage });
    return store.id;
  }

  private async buildAdminStoreWhere(
    user: AuthenticatedUser,
    options?: { notFoundMessage?: string },
  ): Promise<Prisma.StoreWhereInput> {
    if (this.isDeveloper(user)) {
      return this.buildAdminStoreExclusionWhere();
    }

    return {
      id: await this.resolveObservedStoreId(
        user,
        options?.notFoundMessage ?? '当前未选中目标商家门店，暂无法查看平台数据',
      ),
    };
  }

  private async assertCanAccessAdminStore(
    user: AuthenticatedUser,
    storeId: number,
    notFoundMessage: string,
  ): Promise<void> {
    if (await this.canAccessAdminStore(user, storeId)) {
      return;
    }

    throw new NotFoundException(notFoundMessage);
  }

  private async canAccessAdminStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<boolean> {
    if (this.isDeveloper(user)) {
      return !(await this.isExcludedAdminStore(storeId));
    }

    if (user.currentMembership?.storeId === storeId) {
      return true;
    }

    const resolvedStore = await this.pulseStoreContextService.resolveTargetStore(user);
    return resolvedStore.store?.id === storeId;
  }

  private isDeveloper(user: AuthenticatedUser): boolean {
    return user.isPulseDeveloper === true || user.pulseMode === 'developer';
  }

  private buildAdminStoreExclusionWhere(): Prisma.StoreWhereInput {
    const excludedEmails = Array.from(this.pulseDevAccountEmails);
    if (excludedEmails.length === 0) {
      return {};
    }

    return {
      owner: {
        email: {
          notIn: excludedEmails,
        },
      },
    };
  }

  private async isExcludedAdminStore(storeId: number): Promise<boolean> {
    if (this.pulseDevAccountEmails.size === 0) {
      return false;
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        owner: {
          select: {
            email: true,
          },
        },
      },
    });

    return store
      ? this.pulseDevAccountEmails.has(store.owner.email.trim().toLowerCase())
      : false;
  }

  private buildScopedUser(
    user: AuthenticatedUser,
    storeId: number,
  ): AuthenticatedUser {
    const membership = user.currentMembership ?? {
      staffId: 0,
      storeId,
      role: StaffRole.OWNER,
      permissions: ['*'],
      isActive: true,
    };

    return {
      ...user,
      currentMembership: {
        ...membership,
        storeId,
      },
    };
  }

  private resolveTargetStoreForGrowth(
    user: AuthenticatedUser,
    options?: {
      notFoundMessage?: string;
    },
  ) {
    return this.pulseStoreContextService.resolveTargetStoreOrThrow(user, {
      notFoundMessage:
        options?.notFoundMessage ??
        '当前未选中目标商家门店，暂无法使用增长中心',
    });
  }

  private filterLogsByType(
    logs: PartnerBeanLogRecord[],
    type: PulseEarningsLogTypeValue,
  ): PartnerBeanLogRecord[] {
    if (type === 'all') {
      return logs;
    }

    return logs.filter((log) => this.resolveBeanType(log) === type);
  }

  private resolveBeanType(log: PartnerBeanLogRecord): BeanTypeValue {
    if (log.source === 'withdrawal') {
      return 'withdraw';
    }

    return log.changeAmount >= 0 ? 'earn' : 'spend';
  }

  private mapBeanLog(
    log: PartnerBeanLogRecord,
    ownerName: string | null,
  ): PulseEarningsLogItemDto {
    return {
      id: `bean-${log.id}`,
      userId: `store-owner-${log.id}`,
      userName: ownerName ?? '目标商家',
      userPhone: '',
      amount: log.changeAmount,
      type: this.resolveBeanType(log),
      source: log.source,
      description: log.description,
      relatedPromoId:
        log.relatedPromoRecordId != null
          ? `promo-${log.relatedPromoRecordId}`
          : undefined,
      relatedUser: log.relatedUser ?? undefined,
      createdAt: log.createdAt.getTime(),
    };
  }

  private mapAdminPartnerApplication(application: {
    id: number;
    name: string;
    phone: string;
    region: string[];
    applyReason: string | null;
    createdAt: Date;
    status: string;
  }): {
    id: string;
    name: string;
    phone: string;
    city: string;
    appliedAt: string;
    reason: string;
    avatar: string;
    status: PulsePartnerApplicationStatusValue;
  } {
    return {
      id: String(application.id),
      name: application.name,
      phone: this.maskPhone(application.phone),
      city: this.resolveRegionCity(application.region),
      appliedAt: this.formatDateTime(application.createdAt),
      reason: application.applyReason?.trim() || '暂无申请理由',
      avatar: application.name.trim().slice(0, 1) || '合',
      status: this.normalizePartnerApplicationStatus(application.status),
    };
  }

  private filterAdminPartnerApplications<T extends { status: PulsePartnerApplicationStatusValue }>(
    items: T[],
    tab?: GetPulseAdminPartnerApplicationsQueryDto['tab'],
  ): T[] {
    if (!tab || tab === 'all') {
      return items;
    }

    return items.filter((item) => item.status === tab);
  }

  private normalizePartnerApplicationStatus(
    status: string,
  ): PulsePartnerApplicationStatusValue {
    switch (status) {
      case 'approved':
        return 'approved';
      case 'rejected':
        return 'rejected';
      default:
        return 'pending';
    }
  }

  private mapAdminPayoutItem(withdrawal: {
    id: number;
    rmbAmount: number;
    accountType: 'wechat' | 'alipay' | 'bank';
    accountNo: string;
    accountName: string;
    status: PartnerWithdrawalStatus;
    appliedAt: Date;
    paidAt: Date | null;
    rejectReason: string | null;
    partner: {
      name: string | null;
      phone: string | null;
      region: string[];
    };
  }): {
    id: string;
    partnerName: string;
    partnerPhone: string;
    partnerCity: string;
    amount: number;
    accountType: 'wechat' | 'alipay' | 'bank';
    accountNo: string;
    accountName: string;
    status: AdminPayoutStatus;
    appliedAt: string;
    paidAt: string | null;
    txnNo: string | null;
    rejectReason: string | null;
  } {
    return {
      id: String(withdrawal.id),
      partnerName: withdrawal.partner.name?.trim() || '未命名合伙人',
      partnerPhone: this.maskPhone(withdrawal.partner.phone ?? ''),
      partnerCity: this.resolveRegionCity(withdrawal.partner.region),
      amount: withdrawal.rmbAmount,
      accountType: withdrawal.accountType,
      accountNo: withdrawal.accountNo,
      accountName: withdrawal.accountName,
      status: this.normalizeAdminPayoutStatus(withdrawal.status),
      appliedAt: this.formatDateTime(withdrawal.appliedAt),
      paidAt: withdrawal.paidAt ? this.formatDateTime(withdrawal.paidAt) : null,
      txnNo: null,
      rejectReason: withdrawal.rejectReason,
    };
  }

  private filterAdminPayouts<T extends { status: AdminPayoutStatus }>(
    items: T[],
    tab?: GetPulseAdminPayoutsQueryDto['tab'],
  ): T[] {
    if (!tab || tab === 'all') {
      return items;
    }

    return items.filter((item) => item.status === tab);
  }

  private normalizeAdminPayoutStatus(status: PartnerWithdrawalStatus): AdminPayoutStatus {
    switch (status) {
      case PartnerWithdrawalStatus.paid:
        return 'paid';
      case PartnerWithdrawalStatus.rejected:
        return 'rejected';
      default:
        return 'pending';
    }
  }

  private resolvePromoDateRange(rawQuery: Record<string, unknown>): PromoDateRange {
    const queryMode = typeof rawQuery.queryMode === 'string' ? rawQuery.queryMode : '';
    if (queryMode === 'day' && typeof rawQuery.date === 'string') {
      const day = this.parseDateOnly(rawQuery.date);
      if (!day) {
        return { startAt: null, endAt: null };
      }

      const startAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
      const endAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
      return { startAt, endAt };
    }

    if (queryMode === 'range') {
      const startAt =
        typeof rawQuery.startDate === 'string'
          ? this.parseDateOnly(rawQuery.startDate)
          : null;
      const endAt =
        typeof rawQuery.endDate === 'string'
          ? this.parseDateOnly(rawQuery.endDate)
          : null;

      return {
        startAt: startAt
          ? new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate(), 0, 0, 0, 0)
          : null,
        endAt: endAt
          ? new Date(endAt.getFullYear(), endAt.getMonth(), endAt.getDate(), 23, 59, 59, 999)
          : null,
      };
    }

    return { startAt: null, endAt: null };
  }

  private parseDateOnly(value: string): Date | null {
    const normalizedValue = value.trim().replace(/\./g, '-').replace(/\//g, '-');
    const matched = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!matched) {
      return null;
    }

    const [, yearText, monthText, dayText] = matched;
    const year = Number.parseInt(yearText, 10);
    const month = Number.parseInt(monthText, 10);
    const day = Number.parseInt(dayText, 10);
    const parsedDate = new Date(year, month - 1, day);

    if (
      Number.isNaN(parsedDate.getTime())
      || parsedDate.getFullYear() !== year
      || parsedDate.getMonth() !== month - 1
      || parsedDate.getDate() !== day
    ) {
      return null;
    }

    return parsedDate;
  }

  private mapAdminPromoPartner(
    partner: {
      storeId: number;
      name: string | null;
      phone: string | null;
      region: string[];
      joinedAt: Date | null;
      store: {
        name: string;
        owner: {
          name: string | null;
        };
        membershipPromoRecords: Array<{
          chargedAmount: number | null;
          chargedAt: Date | null;
          registeredAt: Date;
        }>;
      };
    },
    dateRange: PromoDateRange,
  ): AdminPromoPartnerItem {
    const metrics = partner.store.membershipPromoRecords
      .map((record) => this.toPromoMetricRecord(record))
      .filter((record): record is PromoMetricRecord => record !== null)
      .filter((record) => this.matchesPromoDateRange(record.recordAt, dateRange));

    const series = {
      day: this.buildPromoSeries(metrics, 'day'),
      month: this.buildPromoSeries(metrics, 'month'),
      year: this.buildPromoSeries(metrics, 'year'),
    };
    const partnerName =
      partner.name?.trim() ||
      partner.store.owner.name?.trim() ||
      partner.store.name.trim() ||
      `商家 ${partner.storeId}`;
    const province = partner.region[0] ?? '';
    const city = partner.region[1] ?? province ?? '未知';
    const district = partner.region[2] ?? undefined;
    const revenue = metrics.reduce((sum, record) => sum + record.chargedAmount, 0);

    return {
      id: String(partner.storeId),
      name: partnerName,
      province,
      city,
      district,
      orders: metrics.length,
      revenue,
      growth: 0,
      avatar: partnerName.slice(0, 1) || '合',
      rank: 0,
      joinDate: this.formatDateTime(partner.joinedAt ?? new Date(0)),
      phone: partner.phone?.trim() || '--',
      series,
    };
  }

  private toPromoMetricRecord(record: {
    chargedAmount: number | null;
    chargedAt: Date | null;
    registeredAt: Date;
  }): PromoMetricRecord | null {
    const recordAt = record.chargedAt ?? record.registeredAt;
    if (!recordAt) {
      return null;
    }

    return {
      recordAt,
      chargedAmount: record.chargedAmount ?? 0,
    };
  }

  private matchesPromoDateRange(date: Date, range: PromoDateRange): boolean {
    if (range.startAt && date.getTime() < range.startAt.getTime()) {
      return false;
    }

    if (range.endAt && date.getTime() > range.endAt.getTime()) {
      return false;
    }

    return true;
  }

  private buildPromoSeries(
    metrics: PromoMetricRecord[],
    granularity: 'day' | 'month' | 'year',
  ): AdminPromoPeriodRecord[] {
    const bucketMap = new Map<string, AdminPromoPeriodRecord>();

    metrics.forEach((metric) => {
      const label = this.buildPromoSeriesLabel(metric.recordAt, granularity);
      const current = bucketMap.get(label);
      if (current) {
        current.orders += 1;
        current.revenue += metric.chargedAmount;
        return;
      }

      bucketMap.set(label, {
        label,
        orders: 1,
        revenue: metric.chargedAmount,
      });
    });

    return [...bucketMap.values()].sort((left, right) => {
      const leftTs = this.parsePromoSeriesLabel(left.label, granularity);
      const rightTs = this.parsePromoSeriesLabel(right.label, granularity);
      return leftTs - rightTs;
    });
  }

  private buildPromoSeriesLabel(date: Date, granularity: 'day' | 'month' | 'year'): string {
    if (granularity === 'year') {
      return `${date.getFullYear()}年`;
    }

    if (granularity === 'month') {
      return `${date.getMonth() + 1}月`;
    }

    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  private parsePromoSeriesLabel(
    label: string,
    granularity: 'day' | 'month' | 'year',
  ): number {
    if (granularity === 'year') {
      return Number.parseInt(label, 10) || 0;
    }

    if (granularity === 'month') {
      return Number.parseInt(label, 10) || 0;
    }

    const [monthText, dayText] = label.split('/');
    const month = Number.parseInt(monthText, 10) || 0;
    const day = Number.parseInt(dayText, 10) || 0;
    return month * 100 + day;
  }

  private resolveRegionCity(region: string[]): string {
    if (region.length >= 2) {
      return region[1] ?? region[0] ?? '--';
    }

    return region[0] ?? '--';
  }

  private maskPhone(phone: string): string {
    const normalizedPhone = phone.replace(/\s+/g, '');
    if (!/^1\d{10}$/.test(normalizedPhone)) {
      return normalizedPhone || '--';
    }

    return `${normalizedPhone.slice(0, 3)}****${normalizedPhone.slice(-4)}`;
  }

  private formatDateTime(date: Date): string {
    if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
      return '--';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
}
