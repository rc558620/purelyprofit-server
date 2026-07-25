import { Injectable, NotFoundException } from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ClubCurrentContext } from '../../stores/club-stores.types';
import type { ClubMemberHeldLevelValue } from '../dto/club-member-account.dto';

const CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE = '当前门店暂无会员账户信息';

interface ClubMemberAccountRecord {
  id: number;
  createdAt: Date;
}

interface ClubMarketingCustomerRecord {
  id: number;
  balance: number;
  points: number;
  tier: string;
  createdAt: Date;
}

export interface ClubMemberSnapshot {
  memberId: number;
  storeId: number;
  balance: number;
  level: ClubMemberHeldLevelValue;
  points: number;
  memberCode: string;
  joinDate: string;
  totalConsume: number;
}

@Injectable()
export class ClubMemberProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentSnapshot(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberSnapshot> {
    const snapshot = await this.getSnapshotByStoreAndPhone(
      currentContext.store.id,
      currentContext.user.phone,
    );
    if (!snapshot) {
      throw new NotFoundException(CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE);
    }

    return snapshot;
  }

  async getSnapshotByStoreAndPhone(
    storeId: number,
    phone: string,
  ): Promise<ClubMemberSnapshot | null> {
    const [member, marketingCustomer] = await Promise.all([
      this.findCurrentMember(storeId, phone),
      this.findMarketingCustomer(storeId, phone),
    ]);

    if (!member) {
      return null;
    }

    // 充值累计：通过 marketingRecharge 聚合计算该顾客在该门店的累计充值金额（分）
    const totalRechargeFen = await this.aggregateTotalRechargeAmount(
      marketingCustomer?.id ?? null,
    );

    const joinDate = this.resolveJoinDate(
      member.createdAt,
      marketingCustomer?.createdAt,
    );

    return {
      memberId: member.id,
      storeId,
      // 余额：来自 MarketingCustomer.balance（事实源）
      balance: Money.fromDbCents(
        marketingCustomer?.balance ?? 0,
      ).toOutputYuan(),
      // 等级：来自 MarketingCustomer.tier（事实源，Member.level 废弃）
      level: this.resolveLevel(marketingCustomer?.tier),
      // 积分：来自 MarketingCustomer.points（事实源，Member.points 废弃）
      points: marketingCustomer?.points ?? 0,
      memberCode: this.buildMemberCode(joinDate, member.id),
      joinDate,
      totalConsume: this.resolveTotalRecharge(totalRechargeFen),
    };
  }

  private async findCurrentMember(
    storeId: number,
    phone: string,
  ): Promise<ClubMemberAccountRecord | null> {
    return this.prisma.member.findFirst({
      where: {
        storeId,
        phone,
        status: { not: MemberStatus.banned },
        deletedAt: null,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
  }

  private async findMarketingCustomer(
    storeId: number,
    phone: string,
  ): Promise<ClubMarketingCustomerRecord | null> {
    return this.prisma.marketingCustomer.findFirst({
      where: {
        storeId,
        phone,
        deletedAt: null,
      },
      select: {
        id: true,
        balance: true,
        points: true,
        tier: true,
        createdAt: true,
      },
    });
  }

  /**
   * 聚合计算指定营销顾客的累计充值金额（分）。
   * 仅统计 type='recharge' 的记录，即用户实际充值的本金部分。
   */
  private async aggregateTotalRechargeAmount(
    customerId: number | null,
  ): Promise<number | null> {
    if (customerId === null) {
      return null;
    }

    const result = await this.prisma.marketingRecharge.aggregate({
      where: { customerId, type: 'recharge' },
      _sum: { amount: true },
    });

    // _sum.amount 返回 Prisma.Decimal | null，需显式转为 number
    return Number(result._sum.amount ?? 0);
  }

  private resolveLevel(
    marketingTier: string | undefined,
  ): ClubMemberHeldLevelValue {
    // 等级来自 MarketingCustomer.tier（唯一事实源）
    // Member.level 已废弃，不再读取
    switch (marketingTier) {
      case 'diamond':
        return 'diamond';
      case 'platinum':
        return 'platinum';
      case 'gold':
        return 'gold';
      default:
        // regular / undefined → regular
        return 'regular';
    }
  }

  private resolveJoinDate(
    memberCreatedAt: Date,
    marketingCreatedAt: Date | undefined,
  ): string {
    const joinedAt =
      marketingCreatedAt &&
      marketingCreatedAt.getTime() < memberCreatedAt.getTime()
        ? marketingCreatedAt
        : memberCreatedAt;
    return this.formatDateOnly(joinedAt);
  }

  /**
   * 解析累计充值金额（元）。
   *
   * 使用 marketingRecharge 聚合的充值累计（仅 type='recharge' 记录）；
   * 若无营销顾客档案，返回 0（Member.totalConsumeAmount 已废弃）。
   */
  private resolveTotalRecharge(totalRechargeFen: number | null): number {
    if (typeof totalRechargeFen === 'number') {
      return Money.fromDbCents(totalRechargeFen).toOutputYuan();
    }

    return 0;
  }

  private buildMemberCode(joinDate: string, memberId: number): string {
    const compactDate = joinDate.replace(/-/g, '');
    return `PC${compactDate}${String(memberId).padStart(3, '0')}`;
  }

  /**
   * 将 Date 格式化为 YYYY-MM-DD 字符串，固定使用 UTC+8（北京时间）。
   * 避免服务器部署在 UTC 时区时导致入会日期偏移一天。
   */
  private formatDateOnly(date: Date): string {
    // UTC+8 偏移量 8 小时 = 8 * 60 * 60 * 1000 = 28800000 毫秒
    const utc8Ms = date.getTime() + 8 * 60 * 60 * 1000;
    const utc8Date = new Date(utc8Ms);
    const year = utc8Date.getUTCFullYear();
    const month = String(utc8Date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(utc8Date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
