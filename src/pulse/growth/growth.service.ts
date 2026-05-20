import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PartnerWithdrawalStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  ApplyPlatformPartnerDto,
  PlatformMembershipPlanId,
} from '../../member/platform-membership/dto/platform-membership-query.dto';
import type {
  PlatformMembershipPartnerProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
} from '../../member/platform-membership/dto/platform-membership-response.dto';
import { PlatformMembershipService } from '../../member/platform-membership/platform-membership.service';
import { WithdrawalsService } from '../../member/withdrawals/withdrawals.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  PulseEarningsLogItemDto,
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountResponseDto,
} from './dto/pulse-growth.dto';
import type {
  PulseEarningsLogTypeValue,
  UpdatePulseWithdrawalAccountDto,
} from './dto/pulse-growth.dto';

// ─────────────────────────────────────────────────────────────
// 内部类型
// ─────────────────────────────────────────────────────────────

type BeanTypeValue = 'earn' | 'spend' | 'withdraw';
type BeanSourceValue =
  | 'promo_reward'
  | 'deduct_payment'
  | 'withdrawal'
  | 'admin_adjust';

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

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class PulseGrowthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly withdrawalsService: WithdrawalsService,
  ) {}

  // ──────────────────────────────────────────────
  // 推广中心（代理）
  // ──────────────────────────────────────────────

  getPromoCenter(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.platformMembershipService.getPromoCenter(user);
  }

  // ──────────────────────────────────────────────
  // 合伙人档案（代理）
  // ──────────────────────────────────────────────

  getPartnerProfile(
    user: AuthenticatedUser,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.getPartnerProfile(user);
  }

  // ──────────────────────────────────────────────
  // 申请合伙人（代理）
  // ──────────────────────────────────────────────

  applyPartner(
    user: AuthenticatedUser,
    dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.applyPartner(user, dto);
  }

  // ──────────────────────────────────────────────
  // 撤销合伙人申请（代理）
  // ──────────────────────────────────────────────

  cancelPartnerApplication(
    user: AuthenticatedUser,
    applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.cancelPartnerApplication(
      user,
      applicationId,
    );
  }

  // ──────────────────────────────────────────────
  // 收益总览
  // ──────────────────────────────────────────────

  async getEarningsOverview(
    user: AuthenticatedUser,
  ): Promise<PulseEarningsOverviewResponseDto> {
    const storeId = this.resolveOwnerStoreIdOrThrow(user);

    const [partner, promoRecords, pendingWithdrawals] = await Promise.all([
      this.prisma.storePartner.findUnique({
        where: { storeId },
        select: {
          status: true,
          beanBalance: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
      }),
      this.prisma.storeMembershipPromoRecord.findMany({
        where: { storeId },
        select: { hasCharged: true },
      }),
      this.prisma.partnerWithdrawal.count({
        where: {
          storeId,
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
    const chargedPromos = promoRecords.filter((r) => r.hasCharged).length;

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

  // ──────────────────────────────────────────────
  // 收益明细
  // ──────────────────────────────────────────────

  async getEarningsLogs(
    user: AuthenticatedUser,
    typeFilter: PulseEarningsLogTypeValue = 'all',
  ): Promise<PulseEarningsLogsResponseDto> {
    const storeId = this.resolveOwnerStoreIdOrThrow(user);

    const partner = await this.prisma.storePartner.findUnique({
      where: { storeId },
      select: { id: true, status: true, beanBalance: true },
    });

    if (!partner || partner.status !== 'approved') {
      return { items: [], beanBalance: 0 };
    }

    const rawLogs = await this.prisma.storePartnerBeanLog.findMany({
      where: { storeId, partnerId: partner.id },
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

    // 对齐前端 BeanRecord：老板自己查看自己的流水，userId/userName/userPhone 用当前登录用户填充
    const userIdStr = String(user.id);
    const userName = user.name ?? '';
    const userPhone = user.phone;

    return {
      items: filteredLogs.map((log) =>
        this.mapBeanLog(log, userIdStr, userName, userPhone),
      ),
      beanBalance: partner.beanBalance,
    };
  }

  // ──────────────────────────────────────────────
  // 提现账户信息
  // ──────────────────────────────────────────────

  async getWithdrawalAccount(
    user: AuthenticatedUser,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    const storeId = this.resolveOwnerStoreIdOrThrow(user);

    const partner = await this.prisma.storePartner.findUnique({
      where: { storeId },
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

  // ──────────────────────────────────────────────
  // 更新提现账户
  // ──────────────────────────────────────────────

  async updateWithdrawalAccount(
    user: AuthenticatedUser,
    dto: UpdatePulseWithdrawalAccountDto,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    const storeId = this.resolveOwnerStoreIdOrThrow(user);

    const partner = await this.prisma.storePartner.findUnique({
      where: { storeId },
      select: { id: true, status: true, beanBalance: true },
    });

    if (!partner || partner.status !== 'approved') {
      throw new ForbiddenException('仅合伙人可设置提现账户');
    }

    const accountNo = dto.accountNo.trim();
    const accountName = dto.accountName.trim();

    if (accountNo === '' || accountName === '') {
      throw new ConflictException('收款信息不能为空');
    }

    await this.prisma.storePartner.update({
      where: { id: partner.id },
      data: {
        paymentAccountType: dto.accountType,
        paymentAccountNo: accountNo,
        paymentAccountName: accountName,
      },
    });

    return {
      isPartner: true,
      accountType: dto.accountType,
      accountNo,
      accountName,
      beanBalance: partner.beanBalance,
    };
  }

  // ──────────────────────────────────────────────
  // 申请提现（代理）
  // ──────────────────────────────────────────────

  applyWithdrawal(
    user: AuthenticatedUser,
    beanAmount: number,
  ): ReturnType<WithdrawalsService['apply']> {
    return this.withdrawalsService.apply(user, {
      beanAmount,
      accountType: 'wechat',
      accountNo: '',
      accountName: '',
    });
  }

  // ──────────────────────────────────────────────
  // 私有：工具方法
  // ──────────────────────────────────────────────

  private resolveOwnerStoreIdOrThrow(user: AuthenticatedUser): number {
    const storeId = user.currentMembership?.storeId;
    if (!storeId) {
      throw new ForbiddenException('当前账号未绑定门店，暂无法使用增长中心');
    }

    return storeId;
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
    userId: string,
    userName: string,
    userPhone: string,
  ): PulseEarningsLogItemDto {
    return {
      id: `bean-${log.id}`,
      userId,
      userName,
      userPhone,
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
}
